import { z } from "zod";
import { MessageSchema } from "./message";
import {
  AnalysisQuestion,
  AnswerSchema,
  ConversationAnalysisSchema,
  EscalationLevel,
  ResponseMode,
  SuggestionSchema,
} from "./analysis";

/**
 * HTTP contract between web and server. Both sides import these so a
 * mismatch is a type error, not a runtime surprise.
 */

/** Either inline messages (simulator) or the id of the enabled live chat. */
const SourceFields = {
  messages: z.array(MessageSchema).min(1).optional(),
  chatId: z.string().optional(),
};

export const AnalyseRequestSchema = z.object({
  ...SourceFields,
  /** Skip the deterministic trigger check (explicit user request). */
  force: z.boolean().optional(),
  /** Escalation from the previous analysis, so a tense conversation lowers the trigger bar. */
  previousEscalation: EscalationLevel.optional(),
});
export type AnalyseRequest = z.infer<typeof AnalyseRequestSchema>;

/**
 * Either the model was consulted, or the trigger layer decided it wasn't
 * worth it and says why. The second case costs nothing.
 */
export const AnalyseResponseSchema = z.discriminatedUnion("triggered", [
  z.object({
    triggered: z.literal(true),
    analysis: ConversationAnalysisSchema,
    suggestion: SuggestionSchema,
    trigger: z.object({ reasons: z.array(z.string()) }),
  }),
  z.object({
    triggered: z.literal(false),
    reason: z.string(),
  }),
]);
export type AnalyseResponse = z.infer<typeof AnalyseResponseSchema>;

export const SuggestRequestSchema = z.object({
  ...SourceFields,
  analysis: ConversationAnalysisSchema,
  mode: ResponseMode,
  /** The suggestion being reshaped, so "shorter" means shorter than *this*. */
  previousSuggestion: z.string().optional(),
});
export type SuggestRequest = z.infer<typeof SuggestRequestSchema>;
export const SuggestResponseSchema = z.object({ suggestion: SuggestionSchema });
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;

export const AskRequestSchema = z.object({
  ...SourceFields,
  analysis: ConversationAnalysisSchema,
  question: AnalysisQuestion,
});
export type AskRequest = z.infer<typeof AskRequestSchema>;
export const AskResponseSchema = AnswerSchema;
export type AskResponse = z.infer<typeof AskResponseSchema>;

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.string(),
  model: z.string(),
  /** Whether the provider believes it can actually serve requests right now. */
  ready: z.boolean(),
  detail: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  /** Stable machine-readable code, e.g. "ai_output_invalid", "ai_auth". */
  code: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
