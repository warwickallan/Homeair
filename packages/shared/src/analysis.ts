import { z } from "zod";

/**
 * Structured AI outputs (brief §14, §15, §27). These schemas are handed
 * straight to the model as the required output format, so keep them plain:
 * no optionals, no defaults, no numeric bounds — validation of *meaning*
 * belongs in the prompt, validation of *shape* is done here.
 */

export const EscalationLevel = z.enum([
  "calm",
  "tense",
  "escalating",
  "high_conflict",
  "cooling",
  "resolved",
]);
export type EscalationLevel = z.infer<typeof EscalationLevel>;

export const RecommendedAction = z.enum([
  "acknowledge",
  "clarify",
  "ask",
  "apologise",
  "explain",
  "factual_correction",
  "pause",
  "move_offline",
]);
export type RecommendedAction = z.infer<typeof RecommendedAction>;

/** The prominent banner (brief §15). "none" when nothing needs shouting about. */
export const WarningKind = z.enum(["none", "stop_typing", "wrong_battle"]);
export type WarningKind = z.infer<typeof WarningKind>;

export const ConversationAnalysisSchema = z.object({
  escalation_level: EscalationLevel,
  /** What the argument is nominally about. */
  surface_topic: z.string(),
  /** What it appears to actually be about. */
  underlying_issue: z.string(),
  user_position: z.string(),
  other_position: z.string(),
  /** Are the two people answering different questions? Empty string if aligned. */
  misalignment: z.string(),
  /** Positions restated without new information, in this conversation only. */
  repeated_patterns: z.array(z.string()),
  recommended_action: RecommendedAction,
  /** false = the copilot thinks replying right now is likely to make it worse. */
  reply_now: z.boolean(),
  warning: z.object({
    kind: WarningKind,
    headline: z.string(),
    detail: z.string(),
  }),
  /** 0–1. How confident the model is in the underlying-issue read. */
  confidence: z.number(),
});
export type ConversationAnalysis = z.infer<typeof ConversationAnalysisSchema>;

export const SuggestionSchema = z.object({
  /** The message the user could send. Verbatim, ready to copy. */
  text: z.string(),
  /** One or two sentences, private to the user, on why this shape. */
  reasoning: z.string(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

/** One model call returns both — halves latency and cost for the main path. */
export const AnalyseOutputSchema = z.object({
  analysis: ConversationAnalysisSchema,
  suggestion: SuggestionSchema,
});
export type AnalyseOutput = z.infer<typeof AnalyseOutputSchema>;

export const AnswerSchema = z.object({
  /** Plain prose. Short paragraphs; may use "-" bullets. */
  answer: z.string(),
});
export type Answer = z.infer<typeof AnswerSchema>;

/** Response modes (brief §16). */
export const ResponseMode = z.enum([
  "default",
  "shorter",
  "warmer",
  "more_direct",
  "more_like_me",
  "de_escalate",
  "clarify",
]);
export type ResponseMode = z.infer<typeof ResponseMode>;

/** Analysis functions (brief §17). */
export const AnalysisQuestion = z.enum([
  "explain_their_view",
  "explain_my_view",
  "what_are_we_arguing_about",
  "am_i_being_unreasonable",
  "what_to_avoid",
]);
export type AnalysisQuestion = z.infer<typeof AnalysisQuestion>;
