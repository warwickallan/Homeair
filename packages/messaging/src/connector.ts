import type { Message } from "@homeair/shared";

/**
 * Transport abstraction (brief §5). Everything downstream sees normalised
 * messages and these events; nothing outside this package touches Baileys.
 */

export type ConnectionStatus =
  | { state: "disconnected"; reason?: string }
  | { state: "connecting" }
  | { state: "qr"; qrDataUrl: string }
  | { state: "connected"; me: { id: string; name?: string } }
  | { state: "logged_out" }
  | { state: "auth_failed"; reason: string };

export type ChatSummary = {
  id: string;
  name: string;
  isGroup: boolean;
  /** ISO timestamp of the most recent message, if known. */
  lastMessageAt?: string;
};

export type ConnectorEvent =
  | { type: "status"; status: ConnectionStatus }
  | { type: "chats"; chats: ChatSummary[] }
  /** Messages from history sync — context, never a trigger. */
  | { type: "history"; messages: Message[] }
  /** A single message. `live` is true for messages arriving in real time. */
  | { type: "message"; message: Message; live: boolean };

export type ConnectorEventHandler = (event: ConnectorEvent) => void;

export interface MessagingConnector {
  readonly name: string;
  initialise(): Promise<void>;
  getStatus(): ConnectionStatus;
  getChats(): ChatSummary[];
  /** Bounded recent messages the connector still holds in memory for a chat. */
  getRecentMessages(chatId: string, limit: number): Message[];
  subscribe(handler: ConnectorEventHandler): () => void;
  /**
   * The ONLY send path in HomeAIR. Called exclusively from the manual SEND
   * route after an explicit user action. Returns the sent message as seen
   * by the transport, or null if the transport gave nothing back.
   */
  sendText(chatId: string, text: string): Promise<Message | null>;
  logout(): Promise<void>;
  disconnect(): Promise<void>;
}
