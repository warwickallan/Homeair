import type { FastifyBaseLogger } from "fastify";
import { AIError, type AIProvider } from "@homeair/ai";
import { buildContext, evaluateTrigger } from "@homeair/conversation";
import type { MessagingConnector } from "@homeair/messaging";
import type { ChatSummary, ConnectionStatus, LiveAnalyseResponse, LiveEvent, Message, StoredAnalysis } from "@homeair/shared";
import type { Db } from "./db";

export type CopilotOptions = {
  connector: MessagingConnector;
  db: Db;
  provider: AIProvider;
  /** Quiet period after an incoming message before analysing (brief §32). */
  batchMs: number;
  recentLimit: number;
  /** How much history to import when a chat is first enabled. */
  historyLimit: number;
  log: FastifyBaseLogger;
};

/**
 * The live pipeline (brief §9):
 *
 *   connector event → privacy router (enabled chat only) → store → debounce
 *   → deterministic trigger → provider (bridge) → store analysis → push to UI
 *
 * Messages for chats that are not enabled are never stored and never reach
 * the provider. Sending happens only through `send()`, which only the manual
 * SEND route calls.
 */
export class CopilotService {
  private readonly subscribers = new Set<(event: LiveEvent) => void>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private readonly rerun = new Set<string>();
  private lastLiveMessageId = new Map<string, string>();

  constructor(private readonly opts: CopilotOptions) {}

  start(): () => void {
    const { connector, db } = this.opts;
    const unsubscribe = connector.subscribe((event) => {
      switch (event.type) {
        case "status":
          this.broadcast({ type: "status", status: event.status });
          break;
        case "chats":
          for (const c of event.chats) db.upsertChat(c);
          this.broadcast({ type: "chats" });
          break;
        case "history": {
          const enabled = db.enabledChatId();
          if (!enabled) break;
          let stored = 0;
          for (const m of event.messages) if (m.chatId === enabled && db.insertMessage(m)) stored += 1;
          if (stored) this.opts.log.info({ stored }, "history imported for enabled chat");
          break;
        }
        case "message":
          this.onMessage(event.message, event.live);
          break;
      }
    });
    return () => {
      unsubscribe();
      for (const t of this.timers.values()) clearTimeout(t);
    };
  }

  subscribe(fn: (event: LiveEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  status(): ConnectionStatus {
    return this.opts.connector.getStatus();
  }

  chats(): { chats: ChatSummary[]; enabledChatId: string | null } {
    // Union of what the connector knows now and what we remembered from before.
    for (const c of this.opts.connector.getChats()) this.opts.db.upsertChat(c);
    return { chats: this.opts.db.listChats(), enabledChatId: this.opts.db.enabledChatId() };
  }

  enableChat(chatId: string): void {
    const { db, connector, historyLimit } = this.opts;
    const previous = db.enabledChatId();
    if (previous && previous !== chatId) db.deleteChatData(previous); // leaving a chat forgets it
    db.setEnabledChat(chatId);
    let imported = 0;
    for (const m of connector.getRecentMessages(chatId, historyLimit)) if (db.insertMessage(m)) imported += 1;
    this.opts.log.info({ imported }, "chat enabled; recent history imported");
    this.broadcast({ type: "chats" });
  }

  disableChat(chatId: string): void {
    const { db } = this.opts;
    if (db.enabledChatId() === chatId) db.setEnabledChat(null);
    db.deleteChatData(chatId);
    this.broadcast({ type: "chats" });
  }

  messages(chatId: string, limit: number): Message[] {
    return this.opts.db.recentMessages(chatId, limit);
  }

  latestAnalysis(chatId: string): StoredAnalysis | null {
    return this.opts.db.latestAnalysis(chatId);
  }

  /** Manual or scheduled analysis of the enabled chat. */
  async analyse(chatId: string, force: boolean): Promise<LiveAnalyseResponse> {
    const { db, provider, recentLimit } = this.opts;
    if (!db.isEnabled(chatId)) throw new Error("Chat is not enabled for AI.");
    if (this.running.has(chatId)) {
      this.rerun.add(chatId);
      return { triggered: false, reason: "An analysis is already running; it will re-run when finished." };
    }
    const messages = db.recentMessages(chatId, recentLimit);
    if (messages.length === 0) return { triggered: false, reason: "No messages yet." };
    const previous = db.latestAnalysis(chatId);
    const decision = force
      ? { analyse: true as const, reasons: ["requested explicitly"] }
      : evaluateTrigger(messages, { previousEscalation: previous?.analysis.escalation_level });
    if (!decision.analyse) {
      this.broadcast({ type: "analysis_skipped", chatId, reason: decision.reason });
      return { triggered: false, reason: decision.reason };
    }

    this.running.add(chatId);
    this.broadcast({ type: "analysing", chatId });
    try {
      const output = await provider.analyseConversation(buildContext(messages, { recentLimit }));
      const stored = db.insertAnalysis({
        chatId,
        triggerMessageId: this.lastLiveMessageId.get(chatId) ?? messages.at(-1)?.id ?? null,
        analysis: output.analysis,
        suggestion: output.suggestion,
        reasons: decision.reasons,
      });
      this.broadcast({ type: "analysis", analysis: stored });
      return { triggered: true, analysis: stored };
    } catch (error) {
      const code = error instanceof AIError ? error.code : "internal";
      const message = error instanceof Error ? error.message : String(error);
      this.opts.log.warn({ code }, "live analysis failed");
      this.broadcast({ type: "error", chatId, code, message });
      throw error;
    } finally {
      this.running.delete(chatId);
      if (this.rerun.delete(chatId)) this.schedule(chatId);
    }
  }

  /** The only send path. Requires the chat to be enabled; called by the manual SEND route only. */
  async send(chatId: string, text: string): Promise<Message | null> {
    const { db, connector } = this.opts;
    if (!db.isEnabled(chatId)) throw new Error("Chat is not enabled.");
    const sent = await connector.sendText(chatId, text);
    if (sent && db.insertMessage(sent)) this.broadcast({ type: "message", message: sent });
    this.opts.log.info("message sent by explicit user action");
    return sent;
  }

  async logout(): Promise<void> {
    await this.opts.connector.logout();
  }

  /** (Re)start the transport, e.g. to get a fresh QR after a logout. */
  async connect(): Promise<void> {
    await this.opts.connector.initialise();
  }

  // --- internals -----------------------------------------------------------

  private onMessage(message: Message, live: boolean): void {
    const { db } = this.opts;
    db.upsertChat({ id: message.chatId, name: "", isGroup: message.chatId.endsWith("@g.us"), lastMessageAt: message.timestamp });
    if (!db.isEnabled(message.chatId)) {
      this.broadcast({ type: "chats" }); // list order changes; content is discarded
      return;
    }
    const isNew = db.insertMessage(message);
    if (!isNew) return;
    this.broadcast({ type: "message", message });
    if (live && message.direction === "incoming") {
      this.lastLiveMessageId.set(message.chatId, message.id);
      this.schedule(message.chatId);
    }
  }

  /** Debounce: wait for the burst to finish, then analyse once (brief §33). */
  private schedule(chatId: string): void {
    const existing = this.timers.get(chatId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      chatId,
      setTimeout(() => {
        this.timers.delete(chatId);
        void this.analyse(chatId, false).catch(() => undefined); // already broadcast as an error event
      }, this.opts.batchMs),
    );
  }

  private broadcast(event: LiveEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        /* a dead SSE client; it will be removed on close */
      }
    }
  }
}
