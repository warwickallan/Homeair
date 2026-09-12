import type { FastifyInstance } from "fastify";
import {
  LiveAnalyseRequestSchema,
  SendRequestSchema,
  type ApiError,
  type ChatsResponse,
  type LatestAnalysisResponse,
  type LiveAnalyseResponse,
  type LiveEvent,
  type MessagesResponse,
  type SendResponse,
  type WhatsAppStatusResponse,
} from "@homeair/shared";
import type { CopilotService } from "./copilot";

/**
 * Live WhatsApp routes. `/api/chats/:id/send` is the only route in HomeAIR
 * that sends anything, and it exists solely to be hit by the SEND button.
 */
export function registerLiveRoutes(app: FastifyInstance, copilot: CopilotService, connectorName: string): void {
  app.get("/api/whatsapp/status", async (): Promise<WhatsAppStatusResponse> => ({ status: copilot.status(), connector: connectorName }));

  app.post("/api/whatsapp/logout", async () => {
    await copilot.logout();
    return { ok: true };
  });

  app.post("/api/whatsapp/connect", async () => {
    void copilot.connect();
    return { ok: true };
  });

  app.get("/api/chats", async (): Promise<ChatsResponse> => copilot.chats());

  app.post<{ Params: { id: string } }>("/api/chats/:id/enable", async (request) => {
    copilot.enableChat(request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/chats/:id/disable", async (request) => {
    copilot.disableChat(request.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/chats/:id/messages", async (request, reply): Promise<MessagesResponse | ApiError> => {
    if (!copilot.chats().enabledChatId || copilot.chats().enabledChatId !== request.params.id) {
      return reply.code(403).send({ error: "Chat is not enabled.", code: "chat_not_enabled" });
    }
    const limit = Math.min(500, Math.max(1, Number.parseInt(request.query.limit ?? "100", 10) || 100));
    return { messages: copilot.messages(request.params.id, limit) };
  });

  app.get<{ Params: { id: string } }>("/api/chats/:id/analysis", async (request): Promise<LatestAnalysisResponse> => ({
    analysis: copilot.latestAnalysis(request.params.id),
  }));

  app.post<{ Params: { id: string } }>("/api/chats/:id/analyse", async (request, reply): Promise<LiveAnalyseResponse | ApiError> => {
    const body = LiveAnalyseRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid request", code: "bad_request" });
    return copilot.analyse(request.params.id, body.data.force ?? false);
  });

  app.post<{ Params: { id: string } }>("/api/chats/:id/send", async (request, reply): Promise<SendResponse | ApiError> => {
    const body = SendRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Message text is required.", code: "bad_request" });
    const message = await copilot.send(request.params.id, body.data.text);
    return { message };
  });

  /** Server-sent events: status, chats, messages, analyses. */
  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const write = (event: LiveEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    write({ type: "status", status: copilot.status() });
    const unsubscribe = copilot.subscribe(write);
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    request.raw.on("close", close);
    request.raw.on("error", close);
  });
}
