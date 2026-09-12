import { describe, expect, it } from "vitest";
import type { WAMessage } from "@whiskeysockets/baileys";
import { canonicalChatId, normaliseWAMessage, toMillis } from "./normalise";

const noNames = () => undefined;

function wa(partial: Partial<WAMessage> & { key: WAMessage["key"] }): WAMessage {
  return { messageTimestamp: 1_700_000_000, ...partial } as WAMessage;
}

describe("normaliseWAMessage", () => {
  it("maps a plain incoming text", () => {
    const m = normaliseWAMessage(
      wa({ key: { remoteJid: "447700900000@s.whatsapp.net", fromMe: false, id: "A1" }, pushName: "Jola", message: { conversation: "hi" } }),
      noNames,
    );
    expect(m).toMatchObject({ id: "A1", chatId: "447700900000@s.whatsapp.net", direction: "incoming", senderName: "Jola", type: "text", text: "hi" });
    expect(m!.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("maps an outgoing extended text with a quote", () => {
    const m = normaliseWAMessage(
      wa({
        key: { remoteJid: "447700900000@s.whatsapp.net", fromMe: true, id: "B2" },
        message: { extendedTextMessage: { text: "yes", contextInfo: { stanzaId: "A1", quotedMessage: { conversation: "coming?" } } } },
      }),
      noNames,
    );
    expect(m).toMatchObject({ direction: "outgoing", senderId: "me", senderName: "Me", text: "yes", quotedText: "coming?", replyToMessageId: "A1" });
  });

  it("prefers the phone jid when the chat is addressed by LID", () => {
    expect(canonicalChatId({ remoteJid: "12345@lid", remoteJidAlt: "447700900000@s.whatsapp.net" })).toBe("447700900000@s.whatsapp.net");
    expect(canonicalChatId({ remoteJid: "447700900000@s.whatsapp.net", remoteJidAlt: "12345@lid" })).toBe("447700900000@s.whatsapp.net");
  });

  it("renders media as placeholders and drops protocol noise", () => {
    const img = normaliseWAMessage(wa({ key: { remoteJid: "1@s.whatsapp.net", fromMe: false, id: "C" }, message: { imageMessage: { caption: "look" } } }), noNames);
    expect(img).toMatchObject({ type: "image", text: "look" });
    const audio = normaliseWAMessage(wa({ key: { remoteJid: "1@s.whatsapp.net", fromMe: false, id: "D" }, message: { audioMessage: {} } }), noNames);
    expect(audio).toMatchObject({ type: "audio" });
    const proto = normaliseWAMessage(wa({ key: { remoteJid: "1@s.whatsapp.net", fromMe: false, id: "E" }, message: { protocolMessage: {} } }), noNames);
    expect(proto).toBeNull();
    const reaction = normaliseWAMessage(wa({ key: { remoteJid: "1@s.whatsapp.net", fromMe: false, id: "F" }, message: { reactionMessage: { text: "👍" } } }), noNames);
    expect(reaction).toBeNull();
  });

  it("ignores status broadcasts and channels", () => {
    expect(normaliseWAMessage(wa({ key: { remoteJid: "status@broadcast", fromMe: false, id: "S" }, message: { conversation: "x" } }), noNames)).toBeNull();
    expect(normaliseWAMessage(wa({ key: { remoteJid: "1@newsletter", fromMe: false, id: "N" }, message: { conversation: "x" } }), noNames)).toBeNull();
  });

  it("falls back to the phone number when no name is known", () => {
    const m = normaliseWAMessage(wa({ key: { remoteJid: "447700900000@s.whatsapp.net", fromMe: false, id: "G" }, message: { conversation: "?" } }), noNames);
    expect(m!.senderName).toBe("+447700900000");
  });

  it("converts Long-ish timestamps", () => {
    expect(toMillis(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMillis({ toNumber: () => 1_700_000_001 })).toBe(1_700_000_001_000);
    expect(toMillis(null)).toBeNull();
  });
});
