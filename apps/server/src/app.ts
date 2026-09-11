import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { AIError, type AIProvider } from "@homeair/ai";
import { buildContext } from "@homeair/conversation";
import {
  AnalyseRequestSchema,
  AskRequestSchema,
  SuggestRequestSchema,
  type AnalyseResponse,
  type ApiError,
  type AskResponse,
  type HealthResponse,
  type SuggestResponse,
} from "@homeair/shared";
import type { z } from "zod";

export type AppOptions = {
  provider: AIProvider;
  recentMessageLimit: number;
  logger?: boolean;
};

/**
 * HTTP surface. Deliberately thin: validate, build context, call the
 * provider, map errors. All reasoning lives in the packages.
 *
 * Privacy: request bodies are never logged. Fastify's default request log
 * carries method/url/status only, and the error handler logs codes, not
 * payloads (brief §22).
 */
export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 2 * 1024 * 1024 });
  void app.register(cors, { origin: true });

  const { provider, recentMessageLimit } = opts;

  app.get("/api/health", async (): Promise<HealthResponse> => {
    return { ok: true, provider: provider.name, model: provider.model };
  });

  app.post("/api/analyse", async (request, reply): Promise<AnalyseResponse | ApiError> => {
    const body = validate(AnalyseRequestSchema, request.body);
    if (!body.ok) return reply.code(400).send(body.error);
    const ctx = buildContext(body.data.messages, { recentLimit: recentMessageLimit });
    return provider.analyseConversation(ctx);
  });

  app.post("/api/suggest", async (request, reply): Promise<SuggestResponse | ApiError> => {
    const body = validate(SuggestRequestSchema, request.body);
    if (!body.ok) return reply.code(400).send(body.error);
    const ctx = buildContext(body.data.messages, { recentLimit: recentMessageLimit });
    const suggestion = await provider.generateResponse({
      ctx,
      analysis: body.data.analysis,
      mode: body.data.mode,
      previousSuggestion: body.data.previousSuggestion,
    });
    return { suggestion };
  });

  app.post("/api/ask", async (request, reply): Promise<AskResponse | ApiError> => {
    const body = validate(AskRequestSchema, request.body);
    if (!body.ok) return reply.code(400).send(body.error);
    const ctx = buildContext(body.data.messages, { recentLimit: recentMessageLimit });
    return provider.answerQuestion({ ctx, analysis: body.data.analysis, question: body.data.question });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AIError) {
      request.log.warn({ code: error.code }, "AI provider error");
      const status = error.code === "ai_auth" ? 401 : error.code === "ai_timeout" ? 504 : 502;
      const payload: ApiError = { error: error.message, code: error.code };
      return reply.code(status).send(payload);
    }
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode < 500) {
      const payload: ApiError = { error: err.message, code: "bad_request" };
      return reply.code(statusCode).send(payload);
    }
    request.log.error({ err: err.message }, "Unhandled error");
    const payload: ApiError = { error: "Internal error", code: "internal" };
    return reply.code(500).send(payload);
  });

  return app;
}

type Validated<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function validate<T>(schema: z.ZodType<T>, input: unknown): Validated<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const where = first?.path.length ? ` at ${first.path.join(".")}` : "";
  return { ok: false, error: { error: `Invalid request${where}: ${first?.message ?? "unknown"}`, code: "bad_request" } };
}
