import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConversationAnalysis, Message, StoredAnalysis, Suggestion } from "@homeair/shared";

/**
 * Local persistence (brief §11), kept to what the product needs:
 * chat metadata for the picker, message content ONLY for the enabled chat,
 * analyses, and a settings bag. Plain SQL on Node's built-in SQLite — no
 * native build, no ORM.
 */
export class Db {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        is_group INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 0,
        last_message_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT,
        direction TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        text TEXT,
        quoted_text TEXT,
        reply_to TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_chat_ts ON messages(chat_id, timestamp);
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        trigger_message_id TEXT,
        analysis_json TEXT NOT NULL,
        suggestion_json TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS analyses_chat ON analyses(chat_id, id);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  // --- chats -----------------------------------------------------------------

  upsertChat(chat: { id: string; name: string; isGroup: boolean; lastMessageAt?: string }): void {
    this.db
      .prepare(
        `INSERT INTO chats (id, name, is_group, last_message_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE chats.name END,
           is_group = excluded.is_group,
           last_message_at = COALESCE(MAX(excluded.last_message_at, chats.last_message_at), excluded.last_message_at, chats.last_message_at),
           updated_at = excluded.updated_at`,
      )
      .run(chat.id, chat.name, chat.isGroup ? 1 : 0, chat.lastMessageAt ?? null, now());
  }

  listChats(): { id: string; name: string; isGroup: boolean; enabled: boolean; lastMessageAt?: string }[] {
    const rows = this.db.prepare(`SELECT id, name, is_group, enabled, last_message_at FROM chats ORDER BY last_message_at DESC NULLS LAST, name`).all() as Row[];
    return rows.map((r) => ({
      id: str(r.id),
      name: str(r.name),
      isGroup: r.is_group === 1,
      enabled: r.enabled === 1,
      ...(r.last_message_at ? { lastMessageAt: str(r.last_message_at) } : {}),
    }));
  }

  enabledChatId(): string | null {
    const row = this.db.prepare(`SELECT id FROM chats WHERE enabled = 1 LIMIT 1`).get() as Row | undefined;
    return row ? str(row.id) : null;
  }

  isEnabled(chatId: string): boolean {
    return this.enabledChatId() === chatId;
  }

  /** Exactly one chat may be enabled (brief §4.2, MVP). */
  setEnabledChat(chatId: string | null): void {
    this.db.prepare(`UPDATE chats SET enabled = 0, updated_at = ? WHERE enabled = 1`).run(now());
    if (chatId) this.db.prepare(`UPDATE chats SET enabled = 1, updated_at = ? WHERE id = ?`).run(now(), chatId);
  }

  chatName(chatId: string): string | null {
    const row = this.db.prepare(`SELECT name FROM chats WHERE id = ?`).get(chatId) as Row | undefined;
    return row ? str(row.name) : null;
  }

  // --- messages --------------------------------------------------------------

  /** Idempotent by message id (brief §32 dedup). Returns true if newly stored. */
  insertMessage(m: Message): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO messages (id, chat_id, sender_id, sender_name, direction, timestamp, type, text, quoted_text, reply_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.id, m.chatId, m.senderId, m.senderName ?? null, m.direction, m.timestamp, m.type, m.text ?? null, m.quotedText ?? null, m.replyToMessageId ?? null, now());
    return result.changes > 0;
  }

  recentMessages(chatId: string, limit: number): Message[] {
    const rows = this.db
      .prepare(`SELECT * FROM (SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`)
      .all(chatId, limit) as Row[];
    return rows.map(rowToMessage);
  }

  deleteChatData(chatId: string): void {
    this.db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chatId);
    this.db.prepare(`DELETE FROM analyses WHERE chat_id = ?`).run(chatId);
  }

  deleteAllConversationData(): void {
    this.db.exec(`DELETE FROM messages; DELETE FROM analyses;`);
  }

  // --- analyses --------------------------------------------------------------

  insertAnalysis(input: { chatId: string; triggerMessageId: string | null; analysis: ConversationAnalysis; suggestion: Suggestion; reasons: string[] }): StoredAnalysis {
    const createdAt = now();
    const result = this.db
      .prepare(`INSERT INTO analyses (chat_id, trigger_message_id, analysis_json, suggestion_json, reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.chatId, input.triggerMessageId, JSON.stringify(input.analysis), JSON.stringify(input.suggestion), JSON.stringify(input.reasons), createdAt);
    return { id: Number(result.lastInsertRowid), chatId: input.chatId, triggerMessageId: input.triggerMessageId, analysis: input.analysis, suggestion: input.suggestion, reasons: input.reasons, createdAt };
  }

  latestAnalysis(chatId: string): StoredAnalysis | null {
    const row = this.db.prepare(`SELECT * FROM analyses WHERE chat_id = ? ORDER BY id DESC LIMIT 1`).get(chatId) as Row | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      chatId: str(row.chat_id),
      triggerMessageId: row.trigger_message_id ? str(row.trigger_message_id) : null,
      analysis: JSON.parse(str(row.analysis_json)) as ConversationAnalysis,
      suggestion: JSON.parse(str(row.suggestion_json)) as Suggestion,
      reasons: JSON.parse(str(row.reasons_json)) as string[],
      createdAt: str(row.created_at),
    };
  }

  // --- settings --------------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as Row | undefined;
    return row ? str(row.value) : null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  close(): void {
    this.db.close();
  }
}

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function rowToMessage(r: Row): Message {
  return {
    id: str(r.id),
    chatId: str(r.chat_id),
    senderId: str(r.sender_id),
    ...(r.sender_name ? { senderName: str(r.sender_name) } : {}),
    direction: str(r.direction) as Message["direction"],
    timestamp: str(r.timestamp),
    type: str(r.type) as Message["type"],
    ...(r.text != null ? { text: str(r.text) } : {}),
    ...(r.quoted_text ? { quotedText: str(r.quoted_text) } : {}),
    ...(r.reply_to ? { replyToMessageId: str(r.reply_to) } : {}),
  };
}
