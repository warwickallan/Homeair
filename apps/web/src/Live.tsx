import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisQuestion, ChatSummary, ConnectionStatus, HealthResponse, LiveEvent, Message, ResponseMode, StoredAnalysis } from "@homeair/shared";
import { api } from "./api";
import { InsightPanel, relative, type Busy } from "./InsightPanel";
import { live, subscribeLive } from "./live-api";

type Tab = "chat" | "copilot";

export function Live({ health }: { health: HealthResponse | null }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [connector, setConnector] = useState<string>("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [enabledChatId, setEnabledChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stored, setStored] = useState<StoredAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [skipped, setSkipped] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ question: AnalysisQuestion; text: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [copilotBadge, setCopilotBadge] = useState(false);
  const [search, setSearch] = useState("");
  const [sseConnected, setSseConnected] = useState(false);
  const threadRef = useRef<HTMLOListElement>(null);
  const tabRef = useRef<Tab>("chat");
  tabRef.current = tab;
  const draftDirtyRef = useRef(false);
  draftDirtyRef.current = draftDirty;

  const enabledChat = useMemo(() => chats.find((c) => c.id === enabledChatId) ?? null, [chats, enabledChatId]);
  const otherName = enabledChat?.name || messages.find((m) => m.direction === "incoming")?.senderName || "Her";

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2500);
  };

  const refreshChats = useCallback(async () => {
    const res = await live.chats();
    setChats(res.chats);
    setEnabledChatId(res.enabledChatId);
    return res;
  }, []);

  const loadChat = useCallback(async (chatId: string) => {
    const [m, a] = await Promise.all([live.messages(chatId, 100), live.latestAnalysis(chatId)]);
    setMessages(m.messages);
    setStored(a.analysis);
    setDraft(a.analysis?.suggestion.text ?? "");
    setDraftDirty(false);
    setFresh(null);
    setAnswer(null);
    setSkipped(null);
  }, []);

  // Initial load.
  useEffect(() => {
    void (async () => {
      try {
        const s = await live.status();
        setStatus(s.status);
        setConnector(s.connector);
        const c = await refreshChats();
        if (c.enabledChatId) await loadChat(c.enabledChatId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refreshChats, loadChat]);

  // Live events.
  useEffect(() => {
    const onEvent = (event: LiveEvent) => {
      switch (event.type) {
        case "status":
          setStatus(event.status);
          if (event.status.state === "connected") void refreshChats();
          break;
        case "chats":
          void refreshChats();
          break;
        case "message":
          setMessages((prev) => (prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message].sort((a, b) => a.timestamp.localeCompare(b.timestamp))));
          break;
        case "analysing":
          setAnalysing(true);
          setSkipped(null);
          break;
        case "analysis":
          setAnalysing(false);
          setStored(event.analysis);
          setSkipped(null);
          if (draftDirtyRef.current) setFresh(event.analysis.suggestion.text);
          else {
            setDraft(event.analysis.suggestion.text);
            setFresh(null);
          }
          if (tabRef.current === "chat") setCopilotBadge(true);
          break;
        case "analysis_skipped":
          setAnalysing(false);
          setSkipped(event.reason);
          break;
        case "error":
          setAnalysing(false);
          setError(event.message);
          break;
      }
    };
    return subscribeLive(onEvent, () => setSseConnected(true));
  }, [refreshChats]);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  const run = async (what: Busy, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const enable = (chatId: string) =>
    run("analyse", async () => {
      await live.enable(chatId);
      await refreshChats();
      await loadChat(chatId);
      setTab("chat");
    });

  const leaveChat = () =>
    run("analyse", async () => {
      if (!enabledChatId) return;
      await live.disable(enabledChatId);
      setMessages([]);
      setStored(null);
      setDraft("");
      await refreshChats();
    });

  const analyseNow = (force: boolean) =>
    run("analyse", async () => {
      if (!enabledChatId) return;
      const res = await live.analyse(enabledChatId, force);
      if (!res.triggered) setSkipped(res.reason);
      // Success arrives over SSE as an "analysis" event.
    });

  const reshape = (mode: ResponseMode) =>
    run(mode, async () => {
      if (!enabledChatId || !stored) return;
      const res = await api.suggest({ chatId: enabledChatId, analysis: stored.analysis, mode, previousSuggestion: draft || stored.suggestion.text });
      setDraft(res.suggestion.text);
      setDraftDirty(false);
      setFresh(null);
    });

  const ask = (question: AnalysisQuestion) =>
    run(question, async () => {
      if (!enabledChatId || !stored) return;
      const res = await api.ask({ chatId: enabledChatId, analysis: stored.analysis, question });
      setAnswer({ question, text: res.answer });
    });

  /** The only send in the app. Reached solely via the SEND button's confirm step. */
  const send = (text: string) =>
    run("send", async () => {
      if (!enabledChatId) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      await live.send(enabledChatId, trimmed);
      setDraft("");
      setDraftDirty(false);
      setFresh(null);
      showToast(`Sent to ${otherName}`);
      setTab("chat");
    });

  const onDraftChange = (text: string) => {
    setDraft(text);
    setDraftDirty(true);
  };

  const filteredChats = chats.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  // --- render ----------------------------------------------------------------

  const waPill = statusPill(status);

  return (
    <div className="live">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">HomeAIR</span>
          {enabledChat ? (
            <span className="brand-sub">
              <strong>{enabledChat.name}</strong>
              <button className="linkish" onClick={leaveChat} disabled={busy !== null}>
                change
              </button>
            </span>
          ) : (
            <span className="brand-sub">Relationship Copilot</span>
          )}
        </div>
        <div className="status">
          <span className={`pill ${waPill.cls}`} title={connector ? `connector: ${connector}` : ""}>
            WhatsApp: {waPill.text}
          </span>
          <span className={`pill ${health ? (health.ready ? "pill-ok" : "pill-bad") : "pill-muted"}`} title={health?.detail ?? ""}>
            AI: {health ? (health.ready ? "ready" : "not ready") : "…"}
          </span>
          <a className="pill pill-muted" href="#/simulator">
            Simulator
          </a>
        </div>
      </header>

      {error && (
        <div className="alert alert-error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}

      {!status && <div className="card card-empty">Connecting to HomeAIR…</div>}

      {status?.state === "qr" && (
        <div className="card qr-card">
          <h2 className="qr-title">Link your WhatsApp</h2>
          <img className="qr" src={status.qrDataUrl} alt="WhatsApp pairing QR code" />
          <ol className="qr-steps">
            <li>On your phone open WhatsApp → <strong>Settings</strong> (or ⋮) → <strong>Linked devices</strong>.</li>
            <li>Tap <strong>Link a device</strong> and scan this code.</li>
            <li>The session is saved locally, so you won't need to scan again after a restart.</li>
          </ol>
          <p className="hint">The code refreshes itself every minute or so. Nothing is read until you pick a chat.</p>
        </div>
      )}

      {status && (status.state === "connecting" || status.state === "disconnected") && (
        <div className="card card-empty">
          <p>{status.state === "connecting" ? "Connecting to WhatsApp…" : `WhatsApp disconnected${status.reason ? ` (${status.reason})` : ""}. Reconnecting…`}</p>
        </div>
      )}

      {status?.state === "logged_out" && (
        <div className="card card-empty">
          <p>WhatsApp session was logged out.</p>
          <button className="btn btn-primary" onClick={() => void live.connect()}>
            Show a new QR code
          </button>
        </div>
      )}

      {status?.state === "auth_failed" && <div className="alert alert-error">Authentication failed: {status.reason}</div>}

      {status?.state === "connected" && !enabledChat && (
        <div className="card picker">
          <div className="card-head">
            <h2>Pick the one conversation HomeAIR may read</h2>
          </div>
          <p className="hint">
            Only this chat's messages are stored and sent to the AI. Everything else stays on your phone. You can change it later.
          </p>
          <input className="search" placeholder="Search chats…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {chats.length === 0 && <p className="hint">Waiting for WhatsApp to send the chat list… this can take a minute after pairing.</p>}
          <ul className="chat-list">
            {filteredChats.map((c) => (
              <li key={c.id} className="chat-row">
                <div className="chat-row-main">
                  <span className="chat-name">{c.name}</span>
                  <span className="hint">
                    {c.isGroup ? "group · " : ""}
                    {c.lastMessageAt ? relative(c.lastMessageAt) : ""}
                  </span>
                </div>
                <button className="btn btn-primary btn-small" onClick={() => enable(c.id)} disabled={busy !== null}>
                  Use this chat
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status?.state === "connected" && enabledChat && (
        <>
          <main className={`live-layout tab-${tab}`}>
            <section className="pane pane-chat">
              <div className="pane-label">ACTUAL WHATSAPP MESSAGES</div>
              <ol className="thread thread-live" ref={threadRef}>
                {messages.length === 0 && <li className="hint">No messages stored yet. New messages will appear here as they arrive.</li>}
                {messages.map((m) => (
                  <li key={m.id} className={`bubble ${m.direction}`}>
                    {m.quotedText && <span className="quoted">{m.quotedText}</span>}
                    <span className="bubble-text">{displayText(m)}</span>
                    <span className="bubble-meta">
                      {m.direction === "outgoing" ? "You" : m.senderName} · {time(m.timestamp)}
                    </span>
                  </li>
                ))}
              </ol>
              {!sseConnected && <div className="hint pane-foot">Live updates connecting…</div>}
            </section>

            <section className="pane pane-copilot">
              <InsightPanel
                otherName={otherName}
                analysis={stored?.analysis ?? null}
                analysedAt={stored?.createdAt}
                reasons={stored?.reasons}
                suggestionReasoning={stored?.suggestion.reasoning}
                draft={draft}
                onDraftChange={onDraftChange}
                freshSuggestion={fresh}
                onUseFresh={() => {
                  if (fresh) setDraft(fresh);
                  setFresh(null);
                  setDraftDirty(false);
                }}
                onMode={reshape}
                onAsk={ask}
                answer={answer}
                busy={busy}
                analysing={analysing}
                skipped={skipped}
                onAnalyseNow={analyseNow}
                onSend={send}
                emptyHint="Nothing analysed yet. When a message worth thinking about arrives, the copilot reads the recent conversation and its guidance appears here. Or tap Analyse now."
              />
            </section>
          </main>

          <nav className="tabbar">
            <button className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>
              Chat
            </button>
            <button
              className={`tab ${tab === "copilot" ? "active" : ""}`}
              onClick={() => {
                setTab("copilot");
                setCopilotBadge(false);
              }}
            >
              Copilot{copilotBadge && <span className="dot" />}
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

function statusPill(status: ConnectionStatus | null): { cls: string; text: string } {
  switch (status?.state) {
    case "connected":
      return { cls: "pill-ok", text: "connected" };
    case "qr":
      return { cls: "pill-warn", text: "scan QR" };
    case "connecting":
      return { cls: "pill-warn", text: "connecting" };
    case "logged_out":
      return { cls: "pill-bad", text: "logged out" };
    case "auth_failed":
      return { cls: "pill-bad", text: "auth failed" };
    case "disconnected":
      return { cls: "pill-bad", text: "disconnected" };
    default:
      return { cls: "pill-muted", text: "…" };
  }
}

function displayText(m: Message): string {
  if (m.type === "text") return m.text ?? "";
  const label = { image: "[Image]", audio: "[Voice message]", video: "[Video]", document: "[Document]", other: "[Unsupported message]" }[m.type];
  return m.text ? `${label} ${m.text}` : label;
}

function time(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
