import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ConversationContext } from "@homeair/conversation";
import { AnalyseOutputSchema, AnswerSchema, SuggestionSchema } from "@homeair/shared";
import type { AnalyseOutput, Answer, Suggestion } from "@homeair/shared";
import { buildAnalysePrompt, buildAskPrompt, buildSuggestPrompt, buildSystemPrompt } from "./prompts";
import { AIError, type AIProvider, type QuestionRequest, type ResponseRequest } from "./provider";
import { DEFAULT_STYLE_PROFILE, type StyleProfile } from "./style-profile";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicProviderOptions = {
  model?: string;
  effort?: Effort;
  apiKey?: string;
  style?: StyleProfile;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Injection point for tests. Defaults to a real client. */
  client?: Pick<Anthropic, "messages">;
};

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * Claude via the official SDK, using structured outputs so every response is
 * validated against the shared Zod schema before anything downstream sees it.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly effort: Effort;
  private readonly client: Pick<Anthropic, "messages">;
  private readonly system: string;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.effort = opts.effort ?? "high";
    this.system = buildSystemPrompt(opts.style ?? DEFAULT_STYLE_PROFILE);
    this.client =
      opts.client ??
      new Anthropic({
        ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        timeout: opts.timeoutMs ?? 120_000,
      });
  }

  analyseConversation(ctx: ConversationContext): Promise<AnalyseOutput> {
    return this.parse(AnalyseOutputSchema, buildAnalysePrompt(ctx));
  }

  generateResponse(req: ResponseRequest): Promise<Suggestion> {
    return this.parse(SuggestionSchema, buildSuggestPrompt(req.ctx, req.analysis, req.mode, req.previousSuggestion));
  }

  answerQuestion(req: QuestionRequest): Promise<Answer> {
    return this.parse(AnswerSchema, buildAskPrompt(req.ctx, req.analysis, req.question));
  }

  private async parse<T extends z.ZodType>(schema: T, userPrompt: string): Promise<z.infer<T>> {
    let response;
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: this.effort, format: zodOutputFormat(schema) },
        system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      });
    } catch (error) {
      throw mapSdkError(error);
    }

    if (response.stop_reason === "refusal") {
      const why = response.stop_details?.explanation ?? "no explanation given";
      throw new AIError("ai_refused", `The model declined this request (${why}).`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AIError("ai_output_invalid", "The model ran out of output tokens before finishing.");
    }
    if (response.parsed_output == null) {
      throw new AIError("ai_output_invalid", "The model returned output that did not match the expected schema.");
    }
    return response.parsed_output;
  }
}

function mapSdkError(error: unknown): AIError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new AIError("ai_auth", "AI provider rejected the API key.", { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIError("ai_timeout", "AI provider timed out.", { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AIError("ai_unavailable", "AI provider is rate limiting; try again shortly.", { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    return new AIError("ai_unavailable", `AI provider error (${error.status ?? "?"}): ${error.message}`, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AIError("ai_unavailable", "Could not reach the AI provider.", { cause: error });
  }
  return new AIError("ai_unavailable", "Unexpected AI provider failure.", { cause: error });
}
