import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackendError, type Backend } from "./backend";
import { buildBridgeApp } from "./server";

const goodRequest = {
  task: "test.generate",
  system: "You are a test.",
  input: "some data",
  schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
};

function fakeBackend(impl: Partial<Backend> = {}): Backend {
  return {
    name: "fake",
    generate: async () => ({ output: { a: "b" }, meta: { backend: "fake", durationMs: 1, model: "fake-1" } }),
    health: async () => ({ ok: true, detail: "fine" }),
    ...impl,
  };
}

describe("bridge server", () => {
  const app = buildBridgeApp({ backend: fakeBackend(), logger: false });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("reports health", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, backend: "fake" });
  });

  it("generates", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/generate", payload: goodRequest });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, output: { a: "b" }, meta: { backend: "fake", durationMs: 1, model: "fake-1" } });
  });

  it("rejects a bad task slug and a missing schema with 400", async () => {
    const bad = await app.inject({ method: "POST", url: "/v1/generate", payload: { ...goodRequest, task: "has spaces" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("bad_request");
    const noSchema = await app.inject({ method: "POST", url: "/v1/generate", payload: { ...goodRequest, schema: undefined } });
    expect(noSchema.statusCode).toBe(400);
  });
});

describe("bridge server with a token", () => {
  const app = buildBridgeApp({ backend: fakeBackend(), logger: false, token: "s3cret" });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("refuses generate without the bearer token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/generate", payload: goodRequest });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("unauthorised");
  });

  it("accepts with the bearer token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/generate", payload: goodRequest, headers: { authorization: "Bearer s3cret" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("bridge server error mapping", () => {
  const codes: Record<string, BackendError["code"]> = {
    auth: "backend_auth",
    limited: "backend_rate_limited",
    gone: "backend_unavailable",
    invalid: "output_invalid",
    slow: "timeout",
  };
  const app = buildBridgeApp({
    backend: fakeBackend({
      generate: async (req) => {
        throw new BackendError(codes[req.task]!, `simulated ${req.task}`);
      },
    }),
    logger: false,
  });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it.each([
    ["auth", 502],
    ["limited", 429],
    ["gone", 503],
    ["invalid", 502],
    ["slow", 504],
  ])("maps %s to HTTP %i with a stable code", async (task, status) => {
    const res = await app.inject({ method: "POST", url: "/v1/generate", payload: { ...goodRequest, task } });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ ok: false, code: codes[task], error: `simulated ${task}` });
  });
});

describe("bridge concurrency gate", () => {
  it("refuses with busy when the queue is full, and recovers", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const app = buildBridgeApp({
      backend: fakeBackend({
        generate: async () => {
          await blocked;
          return { output: {}, meta: { backend: "fake", durationMs: 0 } };
        },
      }),
      logger: false,
      maxConcurrency: 1,
      maxQueue: 1,
    });
    await app.ready();
    const first = app.inject({ method: "POST", url: "/v1/generate", payload: goodRequest });
    const second = app.inject({ method: "POST", url: "/v1/generate", payload: goodRequest });
    await new Promise((r) => setTimeout(r, 20));
    const third = await app.inject({ method: "POST", url: "/v1/generate", payload: goodRequest });
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe("busy");
    release();
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    await app.close();
  });
});
