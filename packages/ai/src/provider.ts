import type { ConversationContext } from "@homeair/conversation";
import type {
  AnalyseOutput,
  AnalysisQuestion,
  Answer,
  ConversationAnalysis,
  ResponseMode,
  Suggestion,
} from "@homeair/shared";

/**
 * Provider abstraction (brief §26). The rest of the application talks to
 * this and nothing else; swapping vendors means adding one file here.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyseConversation(ctx: ConversationContext): Promise<AnalyseOutput>;
  generateResponse(req: ResponseRequest): Promise<Suggestion>;
  answerQuestion(req: QuestionRequest): Promise<Answer>;
}

export type ResponseRequest = {
  ctx: ConversationContext;
  analysis: ConversationAnalysis;
  mode: ResponseMode;
  previousSuggestion?: string;
};

export type QuestionRequest = {
  ctx: ConversationContext;
  analysis: ConversationAnalysis;
  question: AnalysisQuestion;
};

export type AIErrorCode = "ai_output_invalid" | "ai_refused" | "ai_unavailable" | "ai_timeout" | "ai_auth";

/** Every provider failure surfaces as one of these so the API layer can map it cleanly. */
export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AIError";
  }
}
