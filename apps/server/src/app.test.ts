import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AIError, MockProvider, type AIProvider } from "@homeair/ai";
import { parseTranscript } from "@homeair/conversation";
import { buildApp } from "./app";

const messages = parseTranscript("HER: You never listen.\nME: That's not fair.\nHER: THIS IS EXACTLY WHAT I MEAN.");

describe("API with mock provider", () => {
  const app = buildApp({ provider: new MockProvider(0), recentMessageLimit: 30, logger: false });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("reports health with the provider name", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, provider: "mock" });
  });

  it("analyses a conversation and returns analysis + suggestion", async () => {
    const res = await app.inject({ method: "POST", url: "/api/analyse", payload: { messages } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysis.escalation_level).toBeDefined();
    expect(typeof body.suggestion.text).toBe("string");
  });

  it("rejects an empty message list with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/analyse", payload: { messages: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("bad_request");
  });

  it("rejects a malformed message with 400 rather than passing it downstream", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/analyse",
      payload: { messages: [{ id: "x", text: "no direction" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("generates a variant in a given mode", async () => {
    const analysed = (await app.inject({ method: "POST", url: "/api/analyse", payload: { messages } })).json();
    const res = await app.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { messages, analysis: analysed.analysis, mode: "shorter", previousSuggestion: analysed.suggestion.text },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().suggestion.text).toBe("string");
  });

  it("answers an analysis question", async () => {
    const analysed = (await app.inject({ method: "POST", url: "/api/analyse", payload: { messages } })).json();
    const res = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: { messages, analysis: analysed.analysis, question: "explain_their_view" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().answer.length).toBeGreaterThan(0);
  });
});

describe("API when the provider fails", () => {
  const failing: AIProvider = {
    name: "failing",
    model: "none",
    analyseConversation: async () => {
      throw new AIError("ai_output_invalid", "bad json");
    },
    generateResponse: async () => {
      throw new AIError("ai_timeout", "slow");
    },
    answerQuestion: async () => {
      throw new Error("something unexpected");
    },
  };
  const app = buildApp({ provider: failing, recentMessageLimit: 30, logger: false });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("maps malformed AI output to a 502 with a stable code, and the server keeps running", async () => {
    const res = await app.inject({ method: "POST", url: "/api/analyse", payload: { messages } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "bad json", code: "ai_output_invalid" });
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
  });

  it("maps timeouts to 504", async () => {
    const analysis = (await new MockProvider(0).analyseConversation({ chatId: "c", otherName: "Her", recent: messages, omittedCount: 0 })).analysis;
    const res = await app.inject({ method: "POST", url: "/api/suggest", payload: { messages, analysis, mode: "shorter" } });
    expect(res.statusCode).toBe(504);
    expect(res.json().code).toBe("ai_timeout");
  });

  it("hides unexpected error details behind a generic 500", async () => {
    const analysis = (await new MockProvider(0).analyseConversation({ chatId: "c", otherName: "Her", recent: messages, omittedCount: 0 })).analysis;
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: { messages, analysis, question: "what_to_avoid" } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal error", code: "internal" });
  });
});
