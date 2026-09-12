import { z } from "zod";
import { ConversationAnalysisSchema, SuggestionSchema } from "./analysis";
import { MessageSchema } from "./message";

/**
 * Types for the live WhatsApp experience, shared by server and web.
 */

export const ConnectionStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disconnected"), reason: z.string().optional() }),
  z.object({ state: z.literal("connecting") }),
  z.object({ state: z.literal("qr"), qrDataUrl: z.string() }),
  z.object({ state: z.literal("connected"), me: z.object({ id: z.string(), name: z.string().optional() }) }),
  z.object({ state: z.literal("logged_out") }),
  z.object({ state: z.literal("auth_failed"), reason: z.string() }),
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const ChatSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isGroup: z.boolean(),
  lastMessageAt: z.string().optional(),
  enabled: z.boolean(),
});
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/** An analysis as stored: the model's output plus when and why it ran. */
export const StoredAnalysisSchema = z.object({
  id: z.number(),
  chatId: z.string(),
  triggerMessageId: z.string().nullable(),
  analysis: ConversationAnalysisSchema,
  suggestion: SuggestionSchema,
  reasons: z.array(z.string()),
  createdAt: z.string(),
});
export type StoredAnalysis = z.infer<typeof StoredAnalysisSchema>;

export const WhatsAppStatusResponseSchema = z.object({ status: ConnectionStatusSchema, connector: z.string() });
export type WhatsAppStatusResponse = z.infer<typeof WhatsAppStatusResponseSchema>;

export const ChatsResponseSchema = z.object({ chats: z.array(ChatSummarySchema), enabledChatId: z.string().nullable() });
export type ChatsResponse = z.infer<typeof ChatsResponseSchema>;

export const MessagesResponseSchema = z.object({ messages: z.array(MessageSchema) });
export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;

export const LatestAnalysisResponseSchema = z.object({ analysis: StoredAnalysisSchema.nullable() });
export type LatestAnalysisResponse = z.infer<typeof LatestAnalysisResponseSchema>;

export const LiveAnalyseRequestSchema = z.object({ force: z.boolean().optional() });
export type LiveAnalyseRequest = z.infer<typeof LiveAnalyseRequestSchema>;

export const LiveAnalyseResponseSchema = z.discriminatedUnion("triggered", [
  z.object({ triggered: z.literal(true), analysis: StoredAnalysisSchema }),
  z.object({ triggered: z.literal(false), reason: z.string() }),
]);
export type LiveAnalyseResponse = z.infer<typeof LiveAnalyseResponseSchema>;

export const SendRequestSchema = z.object({ text: z.string().trim().min(1).max(4000) });
export type SendRequest = z.infer<typeof SendRequestSchema>;
export const SendResponseSchema = z.object({ message: MessageSchema.nullable() });
export type SendResponse = z.infer<typeof SendResponseSchema>;

/** Server-sent events pushed to the UI. */
export const LiveEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), status: ConnectionStatusSchema }),
  z.object({ type: z.literal("chats") }),
  z.object({ type: z.literal("message"), message: MessageSchema }),
  z.object({ type: z.literal("analysing"), chatId: z.string() }),
  z.object({ type: z.literal("analysis"), analysis: StoredAnalysisSchema }),
  z.object({ type: z.literal("analysis_skipped"), chatId: z.string(), reason: z.string() }),
  z.object({ type: z.literal("error"), chatId: z.string().optional(), code: z.string(), message: z.string() }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;
