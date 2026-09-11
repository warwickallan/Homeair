import { z } from "zod";
import { MessageSchema } from "./message";
import {
  AnalysisQuestion,
  AnalyseOutputSchema,
  AnswerSchema,
  ConversationAnalysisSchema,
  ResponseMode,
  SuggestionSchema,
} from "./analysis";

/**
 * HTTP contract between web and server. Both sides import these so a
 * mismatch is a type error, not a runtime surprise.
 */

export const AnalyseRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
});
export type AnalyseRequest = z.infer<typeof AnalyseRequestSchema>;
export const AnalyseResponseSchema = AnalyseOutputSchema;
export type AnalyseResponse = z.infer<typeof AnalyseResponseSchema>;

export const SuggestRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  analysis: ConversationAnalysisSchema,
  mode: ResponseMode,
  /** The suggestion being reshaped, so "shorter" means shorter than *this*. */
  previousSuggestion: z.string().optional(),
});
export type SuggestRequest = z.infer<typeof SuggestRequestSchema>;
export const SuggestResponseSchema = z.object({ suggestion: SuggestionSchema });
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;

export const AskRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
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
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  /** Stable machine-readable code, e.g. "ai_output_invalid", "ai_refused". */
  code: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
