import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AIError, type AIProvider } from "@homeair/ai";
import { buildContext, evaluateTrigger } from "@homeair/conversation";
import {
  AnalyseRequestSchema,
  AskRequestSchema,
  SuggestRequestSchema,
  type AnalyseResponse,
  type ApiError,
  type AskResponse,
  type HealthResponse,
  type Message,
  type SuggestResponse,
} from "@homeair/shared";
import type { z } from "zod";
import type { CopilotService } from "./copilot";
import { registerLiveRoutes } from "./live-routes";

export type AppOptions = {
  provider: AIProvider;
  recentMessageLimit: number;
  logger?: boolean;
  /** An existing pino logger to share with the rest of the process. */
  loggerInstance?: FastifyBaseLogger;
  /** Live WhatsApp pipeline. Absent in tests of the simulator routes. */
  copilot?: CopilotService;
  connectorName?: string;
  /** Directory of the built web app to serve (production / phone use). */
  staticDir?: string;
};

/**
 * HTTP surface. Deliberately thin: validate, run the deterministic trigger,
 * build context, call the provider, map errors. All reasoning lives in the
 * packages.
 *
 * Privacy: request bodies are never logged. Fastify's default request log
 * carries method/url/status only, and the error handler logs codes, not
 * payloads (brief §22).
 */
export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({
    ...(opts.loggerInstance ? { loggerInstance: opts.loggerInstance } : { logger: opts.logger ?? true }),
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: true,
  });
  void app.register(cors, { origin: true });

  const { provider, recentMessageLimit, copilot } = opts;

  /** Resolves the messages for a simulator-style request: inline, or from the enabled live chat. */
  const resolveMessages = (body: { messages?: Message[]; chatId?: string }): Message[] | ApiError => {
    if (body.messages?.length) return body.messages;
    if (body.chatId && copilot) {
      if (copilot.chats().enabledChatId !== body.chatId) return { error: "Chat is not enabled.", code: "chat_not_enabled" };
      return copilot.messages(body.chatId, recentMessageLimit);
    }
    return { error: "Provide messages or an enabled chatId.", code: "bad_request" };
  };

  app.get("/api/health", async (): Promise<HealthResponse> => {
    const health = provider.health ? await provider.health() : { ok: true, detail: "" };
    return { ok: true, provider: provider.name, model: provider.model, ready: health.ok, detail: health.detail };
  });

  app.post("/api/analyse", async (request, reply): Promise<AnalyseResponse | ApiError> => {
    const body = validate(AnalyseRequestSchema, request.body);
    if (!body.ok) return reply.code(400).send(body.error);
    const messages = resolveMessages(body.data);
    if (!Array.isArray(messages)) return reply.code(400).send(messages);

    // Deterministic gate first: no model call for "👍" or "on my way".
    const decision = body.data.force
      ? { analyse: true as const, reasons: ["requested explicitly"] }
      : evaluateTrigger(messages, { previousEscalation: body.data.previousEscalation });
    if (!decision.analyse) {
      request.log.info({ triggered: false }, "analysis skipped by trigger layer");
      return { triggered: false, reason: decision.reason };
    }

    const ctx = buildContext(messages, { recentLimit: recentMessageLimit });
    const result = await provider.analyseConversation(ctx);
    return { triggered: true, ...result, trigger: { reasons: decision.reasons } };
  });

  app.post("/api/suggest", async (request, reply): Promise<SuggestResponse | ApiError> => {
    const body = validate(SuggestRequestSchema, request.body);
    if (!body.ok) return reply.code(400).send(body.error);
    const messages = resolveMessages(body.data);
    if (!Array.isArray(messages)) return reply.code(400).send(messages);
    const ctx = buildContext(messages, { recentLimit: recentMessageLimit });
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
    const messages = resolveMessages(body.data);
    if (!Array.isArray(messages)) return reply.code(400).send(messages);
    const ctx = buildContext(messages, { recentLimit: recentMessageLimit });
    return provider.answerQuestion({ ctx, analysis: body.data.analysis, question: body.data.question });
  });

  if (copilot) registerLiveRoutes(app, copilot, opts.connectorName ?? "unknown");

  if (opts.staticDir && existsSync(join(opts.staticDir, "index.html"))) {
    void app.register(fastifyStatic, { root: opts.staticDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found", code: "not_found" });
    });
  }

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
    if (/not enabled|not connected/i.test(err.message)) {
      const payload: ApiError = { error: err.message, code: "conflict" };
      return reply.code(409).send(payload);
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
