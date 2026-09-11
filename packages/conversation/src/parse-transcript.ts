import type { Message } from "@homeair/shared";

/**
 * Parses a pasted transcript (brief §28) into normalised messages:
 *
 *   HER: You never listen.
 *   ME: That's not fair.
 *
 * Rules:
 * - A line matching `LABEL:` starts a new message. LABEL is a short word
 *   or name (letters, digits, spaces, apostrophes, hyphens — max 30 chars).
 * - ME / I / MYSELF (case-insensitive) → outgoing. Anything else → incoming.
 * - Following lines without a label continue the current message; blank
 *   lines inside a message are collapsed, blank lines between messages
 *   are ignored.
 * - The transcript is data. Nothing in it is interpreted as an instruction.
 */

const LABEL_RE = /^\s*([A-Za-z][A-Za-z0-9 '\-]{0,29}?)\s*:\s*(.*)$/;
const SELF_LABELS = new Set(["me", "i", "myself"]);

export const SIMULATOR_CHAT_ID = "simulator";

export type ParseOptions = {
  chatId?: string;
  /** Base time for synthetic timestamps; messages are spaced one minute apart. */
  startAt?: Date;
};

export function parseTranscript(text: string, opts: ParseOptions = {}): Message[] {
  const chatId = opts.chatId ?? SIMULATOR_CHAT_ID;
  const start = (opts.startAt ?? new Date()).getTime();

  type Draft = { label: string; lines: string[] };
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const match = LABEL_RE.exec(rawLine);
    if (match) {
      const label = match[1]!.trim();
      const rest = (match[2] ?? "").trim();
      current = { label, lines: rest ? [rest] : [] };
      drafts.push(current);
      continue;
    }
    const line = rawLine.trim();
    if (!current) continue; // text before the first label is ignored
    if (line) current.lines.push(line);
  }

  const messages: Message[] = [];
  let index = 0;
  for (const draft of drafts) {
    const body = draft.lines.join("\n").trim();
    if (!body) continue;
    const isSelf = SELF_LABELS.has(draft.label.toLowerCase());
    const senderId = isSelf ? "me" : draft.label.toLowerCase().replace(/\s+/g, "-");
    messages.push({
      id: `${chatId}-${index}`,
      chatId,
      senderId,
      senderName: isSelf ? "Me" : titleCase(draft.label),
      direction: isSelf ? "outgoing" : "incoming",
      timestamp: new Date(start + index * 60_000).toISOString(),
      type: "text",
      text: body,
    });
    index += 1;
  }
  return messages;
}

function titleCase(label: string): string {
  // "HER" → "Her", "jola" → "Jola"; leave mixed-case names alone.
  if (label === label.toUpperCase() || label === label.toLowerCase()) {
    return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
  }
  return label;
}
