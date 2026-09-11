import { useCallback, useEffect, useMemo, useState } from "react";
import { parseTranscript } from "@homeair/conversation";
import type {
  AnalysisQuestion,
  ConversationAnalysis,
  EscalationLevel,
  HealthResponse,
  Message,
  ResponseMode,
  Suggestion,
} from "@homeair/shared";
import { api } from "./api";
import { EXAMPLE_TRANSCRIPT } from "./example";

type Busy = "analyse" | ResponseMode | AnalysisQuestion | null;

const MODES: { mode: ResponseMode; label: string }[] = [
  { mode: "shorter", label: "Shorter" },
  { mode: "warmer", label: "Warmer" },
  { mode: "more_direct", label: "More Direct" },
  { mode: "more_like_me", label: "More Like Me" },
  { mode: "de_escalate", label: "De-escalate" },
  { mode: "clarify", label: "Clarify" },
];

const QUESTIONS: { question: AnalysisQuestion; label: (other: string) => string }[] = [
  { question: "explain_their_view", label: (o) => `Explain ${possessive(o)} View` },
  { question: "explain_my_view", label: () => "Explain My View" },
  { question: "what_are_we_arguing_about", label: () => "What Are We Actually Arguing About?" },
  { question: "am_i_being_unreasonable", label: () => "Am I Being Unreasonable?" },
  { question: "what_to_avoid", label: () => "What Should I Avoid Saying?" },
];

const ESCALATION_LABEL: Record<EscalationLevel, string> = {
  calm: "CALM",
  tense: "TENSE",
  escalating: "ESCALATING",
  high_conflict: "HIGH",
  cooling: "COOLING",
  resolved: "RESOLVED",
};

function possessive(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "her" || lower === "them") return capitalise(name);
  if (lower === "him") return "His";
  return `${name}'s`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [analysis, setAnalysis] = useState<ConversationAnalysis | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [answer, setAnswer] = useState<{ question: AnalysisQuestion; text: string } | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);
  const [triggerReasons, setTriggerReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e: Error) => setHealthError(e.message));
  }, []);

  const parsed = useMemo(() => parseTranscript(transcript), [transcript]);
  const otherName = useMemo(
    () => messages.find((m) => m.direction === "incoming")?.senderName ?? "Her",
    [messages],
  );

  const run = useCallback(async (what: Busy, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

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
        setTriggerReasons([]);
        setSkipped(result.reason);
        return;
      }
      setSkipped(null);
      setTriggerReasons(result.trigger.reasons);
      setAnalysis(result.analysis);
      setSuggestion(result.suggestion);
    });

  const reshape = (mode: ResponseMode) =>
    run(mode, async () => {
      if (!analysis) return;
      const result = await api.suggest({ messages, analysis, mode, previousSuggestion: suggestion?.text });
      setSuggestion(result.suggestion);
    });

  const ask = (question: AnalysisQuestion) =>
    run(question, async () => {
      if (!analysis) return;
      const result = await api.ask({ messages, analysis, question });
      setAnswer({ question, text: result.answer });
    });

  const copy = async () => {
    if (!suggestion) return;
    try {
      await navigator.clipboard.writeText(suggestion.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard access was blocked — select the text and copy it manually.");
    }
  };

  const stale = analysis !== null && transcript !== "" && JSON.stringify(parsed.map((m) => m.text)) !== JSON.stringify(messages.map((m) => m.text));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">HomeAIR</span>
          <span className="brand-sub">Relationship Copilot · Simulator</span>
        </div>
        <div className="status">
          {health ? (
            <span
              className={`pill ${health.provider === "mock" ? "pill-warn" : health.ready ? "pill-ok" : "pill-bad"}`}
              title={health.detail || health.model}
            >
              AI: {health.provider === "mock" ? "mock" : health.provider}
              {health.model !== "bridge default" && health.provider !== "mock" ? ` · ${health.model}` : ""}
              {health.ready ? "" : " · not ready"}
            </span>
          ) : (
            <span className="pill pill-bad">{healthError ? "server offline" : "connecting…"}</span>
          )}
          <span className="pill pill-muted">WhatsApp: not connected (Phase 2)</span>
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
                {stale ? " · transcript changed since last analysis" : ""}
              </span>
            </div>
          </div>

          {messages.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h2>Conversation</h2>
                <span className="hint">Actual messages</span>
              </div>
              <ol className="thread">
                {messages.map((m) => (
                  <li key={m.id} className={`bubble ${m.direction}`}>
                    <span className="bubble-who">{m.direction === "outgoing" ? "ME" : m.senderName?.toUpperCase()}</span>
                    <span className="bubble-text">{m.text}</span>
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

          {health && !health.ready && health.provider !== "mock" && (
            <div className="alert alert-error" role="alert">
              AI not ready: {health.detail}
            </div>
          )}

          {skipped && !analysis && (
            <div className="card card-empty">
              <p>
                <strong>No model call made.</strong> {skipped}
              </p>
              <p className="hint">The deterministic trigger layer decided this wasn't worth asking the AI about.</p>
              <button className="btn" onClick={() => analyse(true)} disabled={busy !== null}>
                Analyse anyway
              </button>
            </div>
          )}

          {!analysis && !error && !skipped && (
            <div className="card card-empty">
              <p>Paste a conversation and press <strong>Analyse</strong>.</p>
              <p className="hint">Nothing here is ever sent anywhere. You copy what you want to use.</p>
            </div>
          )}

          {analysis && (
            <>
              {analysis.warning.kind !== "none" && (
                <div className={`warning warning-${analysis.warning.kind}`} role="alert">
                  <div className="warning-head">⚠️ {analysis.warning.headline || analysis.warning.kind.replace("_", " ").toUpperCase()}</div>
                  <p>{analysis.warning.detail}</p>
                  {!analysis.reply_now && <p className="warning-foot">Recommendation: don't reply right now.</p>}
                </div>
              )}

              <div className="card">
                <div className="card-head">
                  <h2>Conversation state</h2>
                  <span className={`badge esc-${analysis.escalation_level}`}>ESCALATION: {ESCALATION_LABEL[analysis.escalation_level]}</span>
                </div>
                <dl className="facts">
                  <dt>Surface topic</dt>
                  <dd>{analysis.surface_topic}</dd>
                  <dt>Likely underlying issue</dt>
                  <dd>{analysis.underlying_issue}</dd>
                  <dt>Your position</dt>
                  <dd>{analysis.user_position}</dd>
                  <dt>{possessive(otherName)} position</dt>
                  <dd>{analysis.other_position}</dd>
                  {analysis.misalignment && (
                    <>
                      <dt>Mismatch</dt>
                      <dd>{analysis.misalignment}</dd>
                    </>
                  )}
                  {analysis.repeated_patterns.length > 0 && (
                    <>
                      <dt>Repeating</dt>
                      <dd>
                        <ul>
                          {analysis.repeated_patterns.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                  <dt>Next move</dt>
                  <dd>
                    <code>{analysis.recommended_action.replace(/_/g, " ")}</code>
                    <span className="hint"> · confidence {Math.round(analysis.confidence * 100)}%</span>
                  </dd>
                  {triggerReasons.length > 0 && (
                    <>
                      <dt>Why analysed</dt>
                      <dd className="hint">{triggerReasons.join(" · ")}</dd>
                    </>
                  )}
                </dl>
              </div>

              {suggestion && (
                <div className="card suggestion">
                  <div className="card-head">
                    <h2>Suggested response</h2>
                    <span className="tag-ai">AI SUGGESTION — NOT SENT</span>
                  </div>
                  <blockquote className="suggestion-text">{suggestion.text}</blockquote>
                  <p className="hint reasoning">{suggestion.reasoning}</p>
                  <div className="row wrap">
                    <button className="btn btn-primary" onClick={copy} disabled={busy !== null}>
                      {copied ? "Copied ✓" : "Copy"}
                    </button>
                    {MODES.map(({ mode, label }) => (
                      <button key={mode} className="btn" onClick={() => reshape(mode)} disabled={busy !== null}>
                        {busy === mode ? "…" : label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-head">
                  <h2>Ask the copilot</h2>
                </div>
                <div className="row wrap">
                  {QUESTIONS.map(({ question, label }) => (
                    <button
                      key={question}
                      className={`btn ${answer?.question === question ? "btn-active" : ""}`}
                      onClick={() => ask(question)}
                      disabled={busy !== null}
                    >
                      {busy === question ? "…" : label(otherName)}
                    </button>
                  ))}
                </div>
                {answer && (
                  <div className="answer">
                    <span className="tag-ai">AI ANALYSIS</span>
                    <div className="answer-text">
                      {answer.text.split(/\n{2,}/).map((para, i) => (
                        <p key={i}>{renderInline(para)}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="foot">
        Copilot, not autopilot. HomeAIR never sends messages. Nothing on this page is visible to anyone but you.
      </footer>
    </div>
  );
}

/** Minimal rendering for the answer text: single newlines become line breaks. */
function renderInline(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}
