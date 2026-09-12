import type { Message } from "@homeair/shared";
import type { ChatSummary, ConnectionStatus, ConnectorEvent, ConnectorEventHandler, MessagingConnector } from "./connector";

/**
 * In-process stand-in for WhatsApp so the live screen can be developed and
 * demonstrated without a phone. One chat, a scripted opener, and every text
 * you send gets a reply a few seconds later. Never used in production.
 */
export class FakeConnector implements MessagingConnector {
  readonly name = "fake";
  private status: ConnectionStatus = { state: "disconnected" };
  private readonly handlers = new Set<ConnectorEventHandler>();
  private readonly messages: Message[] = [];
  private readonly chatId = "fake-jola@s.whatsapp.net";
  private counter = 0;

  async initialise(): Promise<void> {
    this.setStatus({ state: "connecting" });
    await new Promise((r) => setTimeout(r, 300));
    this.setStatus({ state: "connected", me: { id: "me@s.whatsapp.net", name: "Me (fake)" } });
    this.emit({ type: "chats", chats: this.getChats() });
    const opener = [
      ["incoming", "You never listen when I tell you something bothers me."],
      ["outgoing", "That's not fair. You asked me yesterday and I literally did it."],
    ] as const;
    for (const [direction, text] of opener) this.messages.push(this.make(direction, text, Date.now() - 600_000 + this.messages.length * 60_000));
    this.emit({ type: "history", messages: [...this.messages] });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getChats(): ChatSummary[] {
    return [
      { id: this.chatId, name: "Jola (fake)", isGroup: false, lastMessageAt: this.messages.at(-1)?.timestamp },
      { id: "fake-school@g.us", name: "School Parents (fake)", isGroup: true, lastMessageAt: new Date(Date.now() - 3_600_000).toISOString() },
    ];
  }

  getRecentMessages(chatId: string, limit: number): Message[] {
    return chatId === this.chatId ? this.messages.slice(-limit) : [];
  }

  subscribe(handler: ConnectorEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendText(chatId: string, text: string): Promise<Message | null> {
    if (chatId !== this.chatId) throw new Error("fake connector only knows one chat");
    const sent = this.make("outgoing", text, Date.now());
    this.messages.push(sent);
    setTimeout(() => this.incoming("THIS IS EXACTLY WHAT I MEAN."), 4000);
    return sent;
  }

  /** Test hook: simulate the other person sending something. */
  incoming(text: string): void {
    const m = this.make("incoming", text, Date.now());
    this.messages.push(m);
    this.emit({ type: "message", message: m, live: true });
  }

  async logout(): Promise<void> {
    this.setStatus({ state: "logged_out" });
  }

  async disconnect(): Promise<void> {
    this.setStatus({ state: "disconnected", reason: "stopped" });
  }

  private make(direction: "incoming" | "outgoing", text: string, at: number): Message {
    this.counter += 1;
    return {
      id: `fake-${this.counter}`,
      chatId: this.chatId,
      senderId: direction === "outgoing" ? "me" : this.chatId,
      senderName: direction === "outgoing" ? "Me" : "Jola",
      direction,
      timestamp: new Date(at).toISOString(),
      type: "text",
      text,
    };
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit({ type: "status", status });
  }

  private emit(event: ConnectorEvent): void {
    for (const h of this.handlers) h(event);
  }
}
