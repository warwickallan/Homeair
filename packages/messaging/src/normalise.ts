import {
  getContentType,
  isJidGroup,
  isJidStatusBroadcast,
  isLidUser,
  jidDecode,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageKey,
} from "@whiskeysockets/baileys";
import type { Message, MessageType } from "@homeair/shared";

/**
 * Baileys → normalised Message (brief §10). Raw WhatsApp objects stop here.
 */

export type NameResolver = (jid: string) => string | undefined;

/** Chat ids that are never conversations: status updates, channels, broadcast lists. */
export function isIgnorableChat(jid: string): boolean {
  return isJidStatusBroadcast(jid) || jid.endsWith("@newsletter") || jid.endsWith("@broadcast");
}

/**
 * WhatsApp now addresses some chats by a LID (`…@lid`) and carries the phone
 * jid alongside. Prefer the phone jid so the same person has one id.
 */
export function canonicalChatId(key: Pick<WAMessageKey, "remoteJid" | "remoteJidAlt">): string | null {
  const primary = key.remoteJid ?? null;
  const alt = key.remoteJidAlt ?? null;
  if (primary && isLidUser(primary) && alt && alt.endsWith("@s.whatsapp.net")) return alt;
  return primary;
}

export function canonicalJid(id: string | null | undefined, alt?: string | null): string | null {
  if (!id) return null;
  if (isLidUser(id) && alt && alt.endsWith("@s.whatsapp.net")) return alt;
  return id;
}

/** Phone number or LID digits — the last-resort display name. */
export function jidLabel(jid: string): string {
  const decoded = jidDecode(jid);
  if (!decoded?.user) return jid;
  return isLidUser(jid) ? `LID ${decoded.user}` : `+${decoded.user}`;
}

export function toMillis(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === "number") return ts * 1000;
  if (typeof ts === "bigint") return Number(ts) * 1000;
  const maybeLong = ts as { toNumber?: () => number; low?: number };
  if (typeof maybeLong.toNumber === "function") return maybeLong.toNumber() * 1000;
  if (typeof maybeLong.low === "number") return maybeLong.low * 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? n * 1000 : null;
}

export function normaliseWAMessage(msg: WAMessage, resolveName: NameResolver): Message | null {
  const key = msg.key;
  if (!key?.id) return null;
  const chatId = canonicalChatId(key);
  if (!chatId || isIgnorableChat(chatId)) return null;

  const content = normalizeMessageContent(msg.message ?? undefined);
  if (!content) return null;
  const contentType = getContentType(content);
  if (!contentType) return null;

  let type: MessageType = "other";
  let text: string | undefined;
  let quotedText: string | undefined;
  let replyToMessageId: string | undefined;

  switch (contentType) {
    case "conversation":
      type = "text";
      text = content.conversation ?? "";
      break;
    case "extendedTextMessage": {
      type = "text";
      text = content.extendedTextMessage?.text ?? "";
      const ctx = content.extendedTextMessage?.contextInfo;
      if (ctx?.quotedMessage) {
        quotedText = quotedPreview(ctx.quotedMessage);
        replyToMessageId = ctx.stanzaId ?? undefined;
      }
      break;
    }
    case "imageMessage":
      type = "image";
      text = content.imageMessage?.caption ?? undefined;
      break;
    case "videoMessage":
      type = "video";
      text = content.videoMessage?.caption ?? undefined;
      break;
    case "audioMessage":
      type = "audio";
      break;
    case "documentMessage":
      type = "document";
      text = content.documentMessage?.caption ?? content.documentMessage?.fileName ?? undefined;
      break;
    case "stickerMessage":
      type = "other";
      text = "[Sticker]";
      break;
    case "protocolMessage":
    case "reactionMessage":
    case "senderKeyDistributionMessage":
    case "pollUpdateMessage":
      return null; // not conversation content
    default:
      type = "other";
  }

  if (type === "text" && !text) return null;

  const fromMe = key.fromMe === true;
  const isGroup = isJidGroup(chatId) === true;
  const participant = canonicalJid(key.participant, key.participantAlt);
  const senderId = fromMe ? "me" : isGroup && participant ? participant : chatId;
  const senderName = fromMe ? "Me" : (msg.pushName ?? undefined) || resolveName(senderId) || jidLabel(senderId);
  const millis = toMillis(msg.messageTimestamp) ?? Date.now();

  return {
    id: key.id,
    chatId,
    senderId,
    senderName,
    direction: fromMe ? "outgoing" : "incoming",
    timestamp: new Date(millis).toISOString(),
    type,
    ...(text !== undefined ? { text } : {}),
    ...(quotedText ? { quotedText } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  };
}

function quotedPreview(quoted: NonNullable<ReturnType<typeof normalizeMessageContent>>): string | undefined {
  const inner = normalizeMessageContent(quoted);
  if (!inner) return undefined;
  const t = getContentType(inner);
  switch (t) {
    case "conversation":
      return inner.conversation ?? undefined;
    case "extendedTextMessage":
      return inner.extendedTextMessage?.text ?? undefined;
    case "imageMessage":
      return inner.imageMessage?.caption || "[Image]";
    case "videoMessage":
      return inner.videoMessage?.caption || "[Video]";
    case "audioMessage":
      return "[Voice message]";
    case "documentMessage":
      return "[Document]";
    default:
      return undefined;
  }
}
