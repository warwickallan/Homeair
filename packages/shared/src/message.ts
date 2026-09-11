import { z } from "zod";

/**
 * Normalised message model (brief §10). Every transport — the simulator, the
 * WhatsApp connector, anything later — produces this shape and nothing else
 * downstream ever sees a raw whatsapp-web.js object.
 */
export const MessageDirection = z.enum(["incoming", "outgoing"]);
export type MessageDirection = z.infer<typeof MessageDirection>;

export const MessageType = z.enum(["text", "image", "audio", "video", "document", "other"]);
export type MessageType = z.infer<typeof MessageType>;

export const MessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  senderName: z.string().optional(),
  direction: MessageDirection,
  /** ISO 8601 */
  timestamp: z.string(),
  type: MessageType,
  text: z.string().optional(),
  replyToMessageId: z.string().optional(),
  quotedText: z.string().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

/** Placeholder text shown (and sent to the model) for non-text messages. */
export function displayTextFor(message: Message): string {
  if (message.type === "text") return message.text ?? "";
  switch (message.type) {
    case "image":
      return "[Image]";
    case "audio":
      return "[Voice message]";
    case "video":
      return "[Video]";
    case "document":
      return "[Document]";
    default:
      return "[Unsupported message]";
  }
}
