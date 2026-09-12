import { mkdirSync, rmSync } from "node:fs";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type Chat,
  type Contact,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino, { type Logger } from "pino";
import QRCode from "qrcode";
import type { Message } from "@homeair/shared";
import type { ChatSummary, ConnectionStatus, ConnectorEvent, ConnectorEventHandler, MessagingConnector } from "./connector";
import { canonicalJid, isIgnorableChat, jidLabel, normaliseWAMessage, toMillis } from "./normalise";

export type BaileysConnectorOptions = {
  /** Directory for the linked-device session. Persisted so you don't scan every restart. */
  sessionDir: string;
  /** How many recent messages per chat to keep in memory from history sync. */
  historyPerChat?: number;
  logger?: Logger;
};

/**
 * WhatsApp linked-device transport via Baileys (pure WebSocket, no Chromium).
 *
 * Unofficial integration (brief §7): isolated here, reconnects itself,
 * logs failures without content, and nothing else in HomeAIR imports Baileys.
 *
 * What it keeps in memory: chat metadata (for the picker) and a bounded
 * window of recent messages per chat from history sync — so that when a
 * chat is enabled there is immediate context. Nothing is persisted here;
 * the server decides what to store, and only for the enabled chat.
 */
export class BaileysConnector implements MessagingConnector {
  readonly name = "baileys";
  private readonly sessionDir: string;
  private readonly historyPerChat: number;
  private readonly log: Logger;
  private sock: WASocket | null = null;
  private status: ConnectionStatus = { state: "disconnected" };
  private readonly handlers = new Set<ConnectorEventHandler>();
  private readonly chats = new Map<string, ChatSummary>();
  private readonly names = new Map<string, string>();
  private readonly recent = new Map<string, Message[]>();
  private stopping = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(opts: BaileysConnectorOptions) {
    this.sessionDir = opts.sessionDir;
    this.historyPerChat = opts.historyPerChat ?? 50;
    // Baileys logs message internals at debug/trace; warn keeps content out of logs.
    this.log = opts.logger ?? pino({ level: "warn" });
  }

  async initialise(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getChats(): ChatSummary[] {
    return [...this.chats.values()]
      .map((c) => ({ ...c, name: this.displayName(c.id, c.name) }))
      .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  }

  getRecentMessages(chatId: string, limit: number): Message[] {
    return (this.recent.get(chatId) ?? []).slice(-limit);
  }

  subscribe(handler: ConnectorEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendText(chatId: string, text: string): Promise<Message | null> {
    if (!this.sock || this.status.state !== "connected") throw new Error("WhatsApp is not connected.");
    const sent = await this.sock.sendMessage(chatId, { text });
    if (!sent) return null;
    const message = normaliseWAMessage(sent, (jid) => this.names.get(jid));
    if (message) this.remember(message);
    return message;
  }

  async logout(): Promise<void> {
    this.stopping = true;
    try {
      await this.sock?.logout();
    } catch (error) {
      this.log.warn({ err: (error as Error).message }, "logout failed");
    }
    this.clearSession();
    this.sock = null;
    this.setStatus({ state: "logged_out" });
  }

  async disconnect(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.sock?.end(undefined);
    this.sock = null;
    this.setStatus({ state: "disconnected", reason: "stopped" });
  }

  // --- internals -----------------------------------------------------------

  private async connect(): Promise<void> {
    mkdirSync(this.sessionDir, { recursive: true });
    this.setStatus({ state: "connecting" });

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      version = undefined; // offline: Baileys falls back to its bundled version
    }

    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.log) },
      logger: this.log,
      ...(version ? { version } : {}),
      browser: Browsers.macOS("Desktop"),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", () => void saveCreds());

    sock.ev.on("connection.update", (update) => {
      void (async () => {
        if (update.qr) {
          const qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
          this.setStatus({ state: "qr", qrDataUrl });
        }
        if (update.connection === "connecting") this.setStatus({ state: "connecting" });
        if (update.connection === "open") {
          const me = sock.user;
          this.setStatus({ state: "connected", me: { id: me?.id ? jidNormalizedUser(me.id) : "unknown", name: me?.name ?? undefined } });
        }
        if (update.connection === "close") {
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            this.log.warn("WhatsApp session logged out; clearing local session");
            this.clearSession();
            this.sock = null;
            this.setStatus({ state: "logged_out" });
            return;
          }
          if (this.stopping) return;
          this.setStatus({ state: "disconnected", reason: `code ${code ?? "unknown"}` });
          this.log.warn({ code }, "WhatsApp connection closed; reconnecting");
          this.reconnectTimer = setTimeout(() => void this.connect(), code === DisconnectReason.restartRequired ? 500 : 3000);
        }
      })();
    });

    sock.ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
      for (const c of contacts) this.rememberContact(c);
      for (const c of chats) this.rememberChat(c);
      const normalised: Message[] = [];
      for (const raw of messages) {
        const m = normaliseWAMessage(raw, (jid) => this.names.get(jid));
        if (!m) continue;
        this.remember(m);
        normalised.push(m);
      }
      this.emit({ type: "chats", chats: this.getChats() });
      if (normalised.length) this.emit({ type: "history", messages: normalised });
    });

    sock.ev.on("chats.upsert", (chats) => {
      for (const c of chats) this.rememberChat(c);
      this.emit({ type: "chats", chats: this.getChats() });
    });
    sock.ev.on("chats.update", (updates) => {
      for (const u of updates) if (u.id) this.rememberChat(u as Chat);
      this.emit({ type: "chats", chats: this.getChats() });
    });
    sock.ev.on("contacts.upsert", (contacts) => {
      for (const c of contacts) this.rememberContact(c);
      this.emit({ type: "chats", chats: this.getChats() });
    });
    sock.ev.on("contacts.update", (updates) => {
      for (const c of updates) if (c.id) this.rememberContact(c as Contact);
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const raw of messages) {
        const m = normaliseWAMessage(raw, (jid) => this.names.get(jid));
        if (!m) continue;
        this.remember(m);
        const existing = this.chats.get(m.chatId);
        this.chats.set(m.chatId, {
          id: m.chatId,
          name: existing?.name ?? (m.direction === "incoming" ? m.senderName ?? "" : ""),
          isGroup: isJidGroup(m.chatId) === true,
          lastMessageAt: m.timestamp,
        });
        this.emit({ type: "message", message: m, live: type === "notify" });
      }
      this.emit({ type: "chats", chats: this.getChats() });
    });
  }

  private rememberChat(c: Chat): void {
    const raw = c as Chat & { pnJid?: string | null; lidJid?: string | null; displayName?: string | null };
    const id = canonicalJid(raw.id, raw.pnJid ?? undefined);
    if (!id || isIgnorableChat(id)) return;
    const existing = this.chats.get(id);
    const ts = toMillis(raw.conversationTimestamp);
    const lastMessageAt = ts ? new Date(ts).toISOString() : existing?.lastMessageAt;
    const name = raw.name ?? raw.displayName ?? existing?.name ?? "";
    this.chats.set(id, { id, name, isGroup: isJidGroup(id) === true, lastMessageAt });
  }

  private rememberContact(c: Contact): void {
    const name = c.name ?? c.notify ?? c.verifiedName;
    if (!name) return;
    for (const jid of [c.id, c.phoneNumber, c.lid]) if (jid) this.names.set(jid, name);
  }

  private displayName(id: string, stored: string): string {
    return stored || this.names.get(id) || jidLabel(id);
  }

  private remember(m: Message): void {
    const list = this.recent.get(m.chatId) ?? [];
    if (list.some((x) => x.id === m.id)) return;
    list.push(m);
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (list.length > this.historyPerChat) list.splice(0, list.length - this.historyPerChat);
    this.recent.set(m.chatId, list);
  }

  private clearSession(): void {
    try {
      rmSync(this.sessionDir, { recursive: true, force: true });
    } catch (error) {
      this.log.warn({ err: (error as Error).message }, "could not clear session dir");
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit({ type: "status", status });
  }

  private emit(event: ConnectorEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (error) {
        this.log.error({ err: (error as Error).message }, "connector handler threw");
      }
    }
  }
}
