import { describe, expect, it } from "vitest";
import { parseTranscript } from "./parse-transcript";

const EXAMPLE = `HER:
You never listen when I tell you something bothers me.

ME:
That's not fair. You asked me yesterday and I literally did it.

HER:
THIS IS EXACTLY WHAT I MEAN.

ME:
What? I'm just saying what happened.

HER:
I'm not talking about whether you did it. I'm talking about the way you spoke to me afterwards.`;

describe("parseTranscript", () => {
  it("parses the brief's example conversation into five messages", () => {
    const msgs = parseTranscript(EXAMPLE);
    expect(msgs).toHaveLength(5);
    expect(msgs.map((m) => m.direction)).toEqual(["incoming", "outgoing", "incoming", "outgoing", "incoming"]);
    expect(msgs[0]!.text).toBe("You never listen when I tell you something bothers me.");
    expect(msgs[4]!.text).toMatch(/^I'm not talking about whether you did it/);
  });

  it("supports label and text on the same line", () => {
    const msgs = parseTranscript("HER: hi\nME: hello");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.text).toBe("hi");
    expect(msgs[1]!.text).toBe("hello");
  });

  it("joins continuation lines into one message", () => {
    const msgs = parseTranscript("HER: And another thing\nyou always do this\nand then tell me\nI'm overreacting");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("And another thing\nyou always do this\nand then tell me\nI'm overreacting");
  });

  it("uses a real name as the other participant's display name", () => {
    const msgs = parseTranscript("Jola: hey\nMe: hey");
    expect(msgs[0]!.senderName).toBe("Jola");
    expect(msgs[0]!.direction).toBe("incoming");
    expect(msgs[1]!.senderName).toBe("Me");
    expect(msgs[1]!.direction).toBe("outgoing");
  });

  it("does not treat a colon mid-sentence as a new speaker", () => {
    const msgs = parseTranscript("HER: Here's the thing: you didn't ask.\nME: I did ask, at 5: you were out.");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.text).toBe("Here's the thing: you didn't ask.");
  });

  it("ignores empty messages and text before the first label", () => {
    const msgs = parseTranscript("some preamble\nHER:\n\nME: ok");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.direction).toBe("outgoing");
  });

  it("returns an empty list for empty input", () => {
    expect(parseTranscript("")).toEqual([]);
    expect(parseTranscript("   \n  ")).toEqual([]);
  });

  it("assigns increasing timestamps and stable ids", () => {
    const msgs = parseTranscript("HER: a\nME: b\nHER: c", { startAt: new Date("2026-01-01T00:00:00Z") });
    expect(msgs.map((m) => m.id)).toEqual(["simulator-0", "simulator-1", "simulator-2"]);
    expect(msgs[2]!.timestamp > msgs[0]!.timestamp).toBe(true);
  });
});
