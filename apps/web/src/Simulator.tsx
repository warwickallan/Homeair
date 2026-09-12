import { useMemo, useState } from "react";
import { parseTranscript } from "@homeair/conversation";
import type { AnalysisQuestion, ConversationAnalysis, HealthResponse, Message, ResponseMode, Suggestion } from "@homeair/shared";
import { api } from "./api";
import { EXAMPLE_TRANSCRIPT } from "./example";
import { InsightPanel, type Busy } from "./InsightPanel";

/** Paste-a-transcript mode. Same pipeline as live, no WhatsApp. */
export function Simulator({ health }: { health: HealthResponse | null }) {
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [draft, setDraft] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{ question: AnalysisQuestion; text: string } | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseTranscript(transcript), [transcript]);
  const otherName = messages.find((m) => m.direction === "incoming")?.senderName ?? "Her";

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

  const analyse = (force = false) =>
    run("analyse", async () => {
      const msgs = parseTranscript(transcript);
      setMessages(msgs);
      setAnswer(null);
      if (msgs.length === 0) throw new Error("Nothing to analyse — paste a conversation using HER: / ME: labels.");
      const result = await api.analyse({ messages: msgs, force, previousEscalation: analysis?.escalation_level });
      if (!result.triggered) {
        setAnalysis(null);
        setSuggestion(null);
        setDraft("");
        setSkipped(result.reason);
        return;
      }
      setSkipped(null);
      setReasons(result.trigger.reasons);
      setAnalysis(result.analysis);
      setSuggestion(result.suggestion);
      setDraft(result.suggestion.text);
    });

  const reshape = (mode: ResponseMode) =>
    run(mode, async () => {
      if (!analysis) return;
      const result = await api.suggest({ messages, analysis, mode, previousSuggestion: draft || suggestion?.text });
      setSuggestion(result.suggestion);
      setDraft(result.suggestion.text);
    });

  const ask = (question: AnalysisQuestion) =>
    run(question, async () => {
      if (!analysis) return;
      const result = await api.ask({ messages, analysis, question });
      setAnswer({ question, text: result.answer });
    });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">HomeAIR</span>
          <span className="brand-sub">Simulator · paste a conversation</span>
        </div>
        <div className="status">
          <span className={`pill ${health ? (health.ready ? "pill-ok" : "pill-bad") : "pill-muted"}`} title={health?.detail ?? ""}>
            AI: {health ? (health.ready ? "ready" : "not ready") : "…"}
          </span>
          <a className="pill pill-muted" href="#/">
            ← Live
          </a>
        </div>
      </header>

      <main className="layout">
        <section className="column">
          <div className="card">
            <div className="card-head">
              <h2>Transcript</h2>
              <button className="btn btn-ghost" onClick={() => setTranscript(EXAMPLE_TRANSCRIPT)} disabled={busy !== null}>
                Load example
              </button>
            </div>
            <textarea
              className="transcript"
              placeholder={"Paste a conversation:\n\nHER: ...\nME: ...\nHER: ..."}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              spellCheck={false}
            />
            <div className="row">
              <button className="btn btn-primary" onClick={() => analyse()} disabled={busy !== null || parsed.length === 0}>
                {busy === "analyse" ? "Analysing…" : "Analyse"}
              </button>
              <span className="hint">
                {parsed.length} message{parsed.length === 1 ? "" : "s"} parsed
              </span>
            </div>
          </div>

          {messages.length > 0 && (
            <div className="card">
              <div className="pane-label">ACTUAL MESSAGES</div>
              <ol className="thread">
                {messages.map((m) => (
                  <li key={m.id} className={`bubble ${m.direction}`}>
                    <span className="bubble-text">{m.text}</span>
                    <span className="bubble-meta">{m.direction === "outgoing" ? "You" : m.senderName}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section className="column">
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          {skipped && !analysis && (
            <div className="card card-empty">
              <p>
                <strong>No model call made.</strong> {skipped}
              </p>
              <button className="btn" onClick={() => analyse(true)} disabled={busy !== null}>
                Analyse anyway
              </button>
            </div>
          )}
          {!skipped && (
            <InsightPanel
              otherName={otherName}
              analysis={analysis}
              reasons={reasons}
              suggestionReasoning={suggestion?.reasoning}
              draft={draft}
              onDraftChange={setDraft}
              onMode={reshape}
              onAsk={ask}
              answer={answer}
              busy={busy}
              emptyHint="Paste a conversation and press Analyse."
            />
          )}
        </section>
      </main>
    </div>
  );
}
