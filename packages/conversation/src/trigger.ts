import type { EscalationLevel, Message } from "@homeair/shared";

/**
 * Deterministic trigger layer (brief §21). Decides whether the latest
 * messages warrant spending a model call. No AI involved; every rule is a
 * plain string check so it is cheap, testable and explainable.
 *
 * "👍", "OK", "On my way", "Milk?" should never reach the model.
 * "THIS IS EXACTLY WHAT I MEAN." always should.
 */

export type TriggerDecision = { analyse: true; reasons: string[] } | { analyse: false; reason: string };

export type TriggerOptions = {
  /** Escalation from the last analysis, if any. A tense conversation lowers the bar. */
  previousEscalation?: EscalationLevel;
  /** Characters at or above which a single message counts as substantive. */
  substantiveChars?: number;
};

const TENSE_LEVELS = new Set<EscalationLevel>(["tense", "escalating", "high_conflict"]);

/** Words and phrases that usually mean feelings or conflict are in play. */
const CONFLICT_PATTERNS: RegExp[] = [
  /\b(never|always)\b/i,
  /\bnot fair\b|\bunfair\b/i,
  /\bdon'?t care\b|\bcouldn'?t care\b/i,
  /\bfed up\b|\bsick of\b|\bhad enough\b/i,
  /\bexactly what i mean\b/i,
  /\b(listen|listening|ignore|ignoring|dismiss|dismissive)\b/i,
  /\b(upset|angry|annoyed|pissed|furious|hurt|frustrated|disappointed)\b/i,
  /\b(sorry|apologi[sz]e|apology)\b/i,
  /\byou (said|did|do|made|make|told|keep|kept)\b/i,
  /\bwhy (do|did|would|are|can'?t) you\b/i,
  /\bshut up\b|\bleave me alone\b|\bwhatever\b|\bforget it\b/i,
  /\bwe need to talk\b|\btalk about this\b/i,
];

/** Whole-message replies that are short but loaded. */
const LOADED_SHORT = new Set(["fine", "fine.", "whatever", "whatever.", "forget it", "forget it.", "ok then", "ok then.", "right.", "sure."]);

export function evaluateTrigger(messages: Message[], opts: TriggerOptions = {}): TriggerDecision {
  const substantiveChars = opts.substantiveChars ?? 60;
  const batch = latestBatch(messages);
  if (batch.length === 0) return { analyse: false, reason: "No messages to analyse." };

  const reasons: string[] = [];
  if (opts.previousEscalation && TENSE_LEVELS.has(opts.previousEscalation)) {
    reasons.push(`conversation already ${opts.previousEscalation.replace("_", " ")}`);
  }
  if (batch.length >= 3) reasons.push(`burst of ${batch.length} messages`);

  for (const m of batch) {
    const text = (m.text ?? "").trim();
    if (!text) continue;
    const words = wordCount(text);
    if (text.length >= substantiveChars) reasons.push("substantive message");
    if (hasShouting(text)) reasons.push("shouting (capitals)");
    if (words >= 4 && /\?/.test(text)) reasons.push("a real question");
    if (words >= 3 && /!/.test(text)) reasons.push("exclamation");
    if (LOADED_SHORT.has(text.toLowerCase())) reasons.push("short but loaded reply");
    for (const pattern of CONFLICT_PATTERNS) {
      if (pattern.test(text)) {
        reasons.push("emotional or conflict language");
        break;
      }
    }
  }

  const unique = [...new Set(reasons)];
  if (unique.length === 0) {
    return { analyse: false, reason: "Latest messages look routine — nothing here needs analysis." };
  }
  return { analyse: true, reasons: unique };
}

/** Trailing run of consecutive messages from the same sender (brief §33 batching). */
export function latestBatch(messages: Message[]): Message[] {
  if (messages.length === 0) return [];
  const sorted = [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const last = sorted[sorted.length - 1]!;
  const batch: Message[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const m = sorted[i]!;
    if (m.senderId !== last.senderId || m.direction !== last.direction) break;
    batch.unshift(m);
  }
  return batch;
}

/** True for a trivially routine message on its own: acks, emoji, two-word logistics. */
export function isTrivial(text: string): boolean {
  return !evaluateTrigger([{ id: "x", chatId: "x", senderId: "x", direction: "incoming", timestamp: "0", type: "text", text }]).analyse;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

/** Two or more consecutive all-caps words of three or more letters. */
function hasShouting(text: string): boolean {
  return /\b[A-Z]{3,}\b(?:\s+\b[A-Z]{3,}\b)+/.test(text);
}
