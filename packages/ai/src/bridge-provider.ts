import { z } from "zod";
import type { ConversationContext } from "@homeair/conversation";
import { AnalyseOutputSchema, AnswerSchema, SuggestionSchema } from "@homeair/shared";
import type { AnalyseOutput, Answer, Suggestion } from "@homeair/shared";
import type { Effort } from "./anthropic-provider";
import { buildAnalysePrompt, buildAskPrompt, buildSuggestPrompt, buildSystemPrompt } from "./prompts";
import { AIError, type AIErrorCode, type AIProvider, type ProviderHealth, type QuestionRequest, type ResponseRequest } from "./provider";
import { DEFAULT_STYLE_PROFILE, type StyleProfile } from "./style-profile";

export type BridgeProviderOptions = {
  /** Base URL of the local LLM bridge. */
  url?: string;
  token?: string;
  /** Model alias/id passed through to the bridge; bridge default if omitted. */
  model?: string;
  effort?: Effort;
  timeoutMs?: number;
  style?: StyleProfile;
  /** Injection point for tests. */
  fetchFn?: typeof fetch;
};

export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:4317";

/**
 * HomeAIR's default provider: talks to the local LLM bridge over HTTP.
 * HomeAIR does not know or care what sits behind the bridge. Prompts and
 * schemas are HomeAIR's; the bridge only executes.
 */
export class BridgeProvider implements AIProvider {
  readonly name = "bridge";
  readonly model: string;
  private readonly url: string;
  private readonly token: string | undefined;
  private readonly effort: Effort | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly system: string;

  constructor(opts: BridgeProviderOptions = {}) {
    this.url = (opts.url ?? DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
    this.token = opts.token;
    this.model = opts.model ?? "bridge default";
    this.effort = opts.effort;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.system = buildSystemPrompt(opts.style ?? DEFAULT_STYLE_PROFILE);
  }

  analyseConversation(ctx: ConversationContext): Promise<AnalyseOutput> {
    return this.generate("homeair.analyse", AnalyseOutputSchema, buildAnalysePrompt(ctx));
  }

  generateResponse(req: ResponseRequest): Promise<Suggestion> {
    return this.generate(`homeair.suggest.${req.mode}`, SuggestionSchema, buildSuggestPrompt(req.ctx, req.analysis, req.mode, req.previousSuggestion));
  }

  answerQuestion(req: QuestionRequest): Promise<Answer> {
    return this.generate(`homeair.ask.${req.question}`, AnswerSchema, buildAskPrompt(req.ctx, req.analysis, req.question));
  }

  async health(): Promise<ProviderHealth> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}/v1/health`, { headers: this.headers() });
    } catch {
      return { ok: false, detail: `LLM bridge not reachable at ${this.url}. Start it with: npm run dev -w apps/llm-bridge` };
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; detail?: string; backend?: string } | null;
    if (!body) return { ok: false, detail: `LLM bridge at ${this.url} gave an unreadable health response.` };
    return { ok: body.ok === true, detail: `${body.backend ?? "bridge"}: ${body.detail ?? ""}`.trim() };
  }

  private async generate<T extends z.ZodType>(task: string, schema: T, input: string): Promise<z.infer<T>> {
    const body = {
      task,
      system: this.system,
      input,
      schema: z.toJSONSchema(schema),
      ...(this.model !== "bridge default" ? { model: this.model } : {}),
      ...(this.effort ? { effort: this.effort } : {}),
      timeoutMs: this.timeoutMs,
    };

    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}/v1/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs + 5_000),
      });
    } catch (error) {
      const timedOut = (error as Error).name === "TimeoutError";
      throw new AIError(
        timedOut ? "ai_timeout" : "ai_unavailable",
        timedOut ? "LLM bridge timed out." : `LLM bridge not reachable at ${this.url}. Start it with: npm run dev -w apps/llm-bridge`,
        { cause: error },
      );
    }

    const json = (await res.json().catch(() => null)) as
      | { ok: true; output: unknown; meta?: unknown }
      | { ok: false; code?: string; error?: string }
      | null;

    if (!json || json.ok !== true) {
      const code = (json && "code" in json && json.code) || `http_${res.status}`;
      const message = (json && "error" in json && json.error) || `LLM bridge returned HTTP ${res.status}`;
      throw new AIError(mapBridgeCode(code), message);
    }

    const parsed = schema.safeParse(json.output);
    if (!parsed.success) {
      throw new AIError("ai_output_invalid", `LLM bridge output did not match the expected schema (${parsed.error.issues[0]?.message ?? "unknown"}).`);
    }
    return parsed.data;
  }

  private headers(): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }
}

function mapBridgeCode(code: string): AIErrorCode {
  switch (code) {
    case "backend_auth":
      return "ai_auth";
    case "timeout":
      return "ai_timeout";
    case "output_invalid":
      return "ai_output_invalid";
    default:
      return "ai_unavailable";
  }
}
