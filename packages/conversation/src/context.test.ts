import { describe, expect, it } from "vitest";
import { buildContext, renderTranscript } from "./context";
import { parseTranscript } from "./parse-transcript";

describe("buildContext", () => {
  it("keeps only the most recent N messages and reports how many were dropped", () => {
    const text = Array.from({ length: 12 }, (_, i) => `${i % 2 ? "ME" : "HER"}: message ${i}`).join("\n");
    const ctx = buildContext(parseTranscript(text), { recentLimit: 5 });
    expect(ctx.recent).toHaveLength(5);
    expect(ctx.omittedCount).toBe(7);
    expect(ctx.recent[0]!.text).toBe("message 7");
  });

  it("names the other participant from the first incoming message", () => {
    const ctx = buildContext(parseTranscript("Jola: hi\nME: hi"));
    expect(ctx.otherName).toBe("Jola");
  });

  it("renders numbered lines with fixed speaker labels", () => {
    const ctx = buildContext(parseTranscript("HER: one\nME: two"), { recentLimit: 30 });
    expect(renderTranscript(ctx)).toBe("[1] HER: one\n[2] ME: two");
  });

  it("mentions omitted messages in the rendered header", () => {
    const ctx = buildContext(parseTranscript("HER: a\nME: b\nHER: c"), { recentLimit: 2 });
    expect(renderTranscript(ctx)).toMatch(/^\(1 earlier message\(s\) not shown\)\n\[1\] ME: b/);
  });
});
