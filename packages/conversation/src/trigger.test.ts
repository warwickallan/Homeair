import { describe, expect, it } from "vitest";
import { parseTranscript } from "./parse-transcript";
import { evaluateTrigger, isTrivial, latestBatch } from "./trigger";

describe("trigger layer (brief §21): trivial messages never reach the model", () => {
  it.each(["👍", "OK", "ok", "😂", "On my way", "Milk?", "Yep", "k", "thanks", "see you at 6", "lol", "xx"])(
    "does not trigger on %j",
    (text) => {
      expect(isTrivial(text)).toBe(true);
    },
  );

  it.each([
    "You never listen when I tell you something bothers me.",
    "THIS IS EXACTLY WHAT I MEAN.",
    "That's not fair.",
    "Why did you say that to her?",
    "Fine.",
    "whatever",
    "I'm not talking about whether you did it. I'm talking about the way you spoke to me afterwards.",
    "Can we talk about this properly tonight?",
  ])("triggers on %j", (text) => {
    expect(isTrivial(text)).toBe(false);
  });

  it("triggers on the brief's example conversation with explainable reasons", () => {
    const decision = evaluateTrigger(
      parseTranscript(
        "HER: You never listen when I tell you something bothers me.\nME: That's not fair.\nHER: THIS IS EXACTLY WHAT I MEAN.",
      ),
    );
    expect(decision.analyse).toBe(true);
    if (decision.analyse) expect(decision.reasons).toContain("shouting (capitals)");
  });

  it("does not trigger when a heated exchange ends in a routine ack", () => {
    const decision = evaluateTrigger(parseTranscript("HER: You never listen.\nME: That's not fair.\nHER: ok"));
    expect(decision.analyse).toBe(false);
  });

  it("lowers the bar when the conversation is already tense", () => {
    const msgs = parseTranscript("HER: You never listen.\nME: That's not fair.\nHER: ok");
    expect(evaluateTrigger(msgs, { previousEscalation: "high_conflict" }).analyse).toBe(true);
    expect(evaluateTrigger(msgs, { previousEscalation: "calm" }).analyse).toBe(false);
  });

  it("treats a burst of short messages from one sender as one thought worth analysing", () => {
    const msgs = parseTranscript("ME: ok\nHER: and another thing\nHER: you do this\nHER: every time");
    const decision = evaluateTrigger(msgs);
    expect(decision.analyse).toBe(true);
    if (decision.analyse) expect(decision.reasons).toContain("burst of 3 messages");
  });

  it("returns a reason when there is nothing to analyse", () => {
    expect(evaluateTrigger([])).toEqual({ analyse: false, reason: "No messages to analyse." });
  });
});

describe("latestBatch", () => {
  it("returns the trailing run from the same sender", () => {
    const msgs = parseTranscript("HER: a\nME: b\nHER: c\nHER: d\nHER: e");
    expect(latestBatch(msgs).map((m) => m.text)).toEqual(["c", "d", "e"]);
  });
  it("is a single message when senders alternate", () => {
    const msgs = parseTranscript("HER: a\nME: b");
    expect(latestBatch(msgs).map((m) => m.text)).toEqual(["b"]);
  });
});
