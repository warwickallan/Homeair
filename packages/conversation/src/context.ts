import { displayTextFor, type Message } from "@homeair/shared";

/**
 * Layer A context (brief §12): the recent messages the model sees verbatim.
 * Layer B (rolling reconciled state) arrives in Phase 3 and will sit
 * alongside this rather than replacing it.
 */
export type ConversationContext = {
  chatId: string;
  /** Display name for the other participant, e.g. "Her", "Jola". */
  otherName: string;
  /** Recent messages, oldest first, already trimmed to the limit. */
  recent: Message[];
  /** How many older messages were dropped from `recent`. */
  omittedCount: number;
};

export type BuildContextOptions = {
  recentLimit?: number;
};

export const DEFAULT_RECENT_LIMIT = 30;

export function buildContext(messages: Message[], opts: BuildContextOptions = {}): ConversationContext {
  const limit = Math.max(1, opts.recentLimit ?? DEFAULT_RECENT_LIMIT);
  const sorted = [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const recent = sorted.slice(-limit);
  const otherName = sorted.find((m) => m.direction === "incoming")?.senderName?.trim() || "Them";
  return {
    chatId: sorted[0]?.chatId ?? "unknown",
    otherName,
    recent,
    omittedCount: sorted.length - recent.length,
  };
}

/**
 * Renders the recent messages as numbered, labelled lines for the model.
 * Labels are fixed ("ME" / other name) so the model can never be told a
 * message came from the user when it didn't.
 */
export function renderTranscript(ctx: ConversationContext): string {
  const other = ctx.otherName.toUpperCase();
  const lines = ctx.recent.map((m, i) => {
    const who = m.direction === "outgoing" ? "ME" : other;
    const body = displayTextFor(m).replace(/\n/g, "\n    ");
    const quoted = m.quotedText ? ` (replying to: "${m.quotedText}")` : "";
    return `[${i + 1}] ${who}${quoted}: ${body}`;
  });
  const header = ctx.omittedCount > 0 ? `(${ctx.omittedCount} earlier message(s) not shown)\n` : "";
  return header + lines.join("\n");
}
