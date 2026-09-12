import { useEffect, useState } from "react";
import type { AnalysisQuestion, ConversationAnalysis, EscalationLevel, ResponseMode } from "@homeair/shared";

export type Busy = "analyse" | "send" | ResponseMode | AnalysisQuestion | null;

export const MODES: { mode: ResponseMode; label: string }[] = [
  { mode: "shorter", label: "Shorter" },
  { mode: "warmer", label: "Warmer" },
  { mode: "more_direct", label: "More Direct" },
  { mode: "more_like_me", label: "More Like Me" },
  { mode: "de_escalate", label: "De-escalate" },
  { mode: "clarify", label: "Clarify" },
];

export const QUESTIONS: { question: AnalysisQuestion; label: (other: string) => string }[] = [
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

export function possessive(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "her" || lower === "them") return name.charAt(0).toUpperCase() + name.slice(1);
  if (lower === "him") return "His";
  return `${name}'s`;
}

export type InsightPanelProps = {
  otherName: string;
  analysis: ConversationAnalysis | null;
  analysedAt?: string;
  reasons?: string[];
  suggestionReasoning?: string;
  /** Editable suggested response. Owned by the parent so it survives re-renders. */
  draft: string;
  onDraftChange: (text: string) => void;
  /** A newer suggestion arrived while the draft had been edited. */
  freshSuggestion?: string | null;
  onUseFresh?: () => void;
  onMode: (mode: ResponseMode) => void;
  onAsk: (question: AnalysisQuestion) => void;
  answer: { question: AnalysisQuestion; text: string } | null;
  busy: Busy;
  analysing?: boolean;
  skipped?: string | null;
  onAnalyseNow?: (force: boolean) => void;
  /** Present only on the live screen. Sends the CURRENT draft after a confirm tap. */
  onSend?: (text: string) => Promise<void>;
  emptyHint?: string;
};

/**
 * The private copilot panel. Everything in here is amber/dashed and tagged
 * so it can never be mistaken for a real WhatsApp message.
 */
export function InsightPanel(p: InsightPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setConfirming(false), [p.draft]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is selectable */
    }
  };

  const disabled = p.busy !== null || p.analysing === true;

  return (
    <div className="insight">
      <div className="insight-head">
        <span className="tag-ai">PRIVATE HOMEAIR ANALYSIS</span>
        {p.onAnalyseNow && (
          <button className="btn btn-small" onClick={() => p.onAnalyseNow?.(true)} disabled={disabled}>
            {p.analysing ? "Analysing…" : "Analyse now"}
          </button>
        )}
      </div>

      {p.analysing && <div className="analysing">Thinking about the last few messages…</div>}

      {!p.analysis && !p.analysing && (
        <div className="card card-empty">
          <p>{p.emptyHint ?? "No analysis yet."}</p>
          {p.skipped && <p className="hint">Last check: {p.skipped}</p>}
        </div>
      )}

      {p.analysis && (
        <>
          {p.analysis.warning.kind !== "none" && (
            <div className={`warning warning-${p.analysis.warning.kind}`} role="alert">
              <div className="warning-head">⚠️ {p.analysis.warning.headline || p.analysis.warning.kind.replace("_", " ").toUpperCase()}</div>
              <p>{p.analysis.warning.detail}</p>
              {!p.analysis.reply_now && <p className="warning-foot">Recommendation: don't reply right now.</p>}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Conversation state</h2>
              <span className={`badge esc-${p.analysis.escalation_level}`}>ESCALATION: {ESCALATION_LABEL[p.analysis.escalation_level]}</span>
            </div>
            <dl className="facts">
              <dt>What it's about</dt>
              <dd>{p.analysis.underlying_issue}</dd>
              <dt>Your position</dt>
              <dd>{p.analysis.user_position}</dd>
              <dt>{possessive(p.otherName)} position</dt>
              <dd>{p.analysis.other_position}</dd>
              {p.analysis.misalignment && (
                <>
                  <dt>Mismatch</dt>
                  <dd>{p.analysis.misalignment}</dd>
                </>
              )}
              {p.analysis.repeated_patterns.length > 0 && (
                <>
                  <dt>Repeating</dt>
                  <dd>
                    <ul>
                      {p.analysis.repeated_patterns.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
              <dt>Next move</dt>
              <dd>
                <code>{p.analysis.recommended_action.replace(/_/g, " ")}</code>
                <span className="hint"> · confidence {Math.round(p.analysis.confidence * 100)}%</span>
              </dd>
              {(p.analysedAt || p.reasons?.length) && (
                <>
                  <dt>Analysed</dt>
                  <dd className="hint">
                    {p.analysedAt ? relative(p.analysedAt) : ""}
                    {p.reasons?.length ? ` · ${p.reasons.join(" · ")}` : ""}
                  </dd>
                </>
              )}
            </dl>
            {p.skipped && <p className="hint skipped-note">Since then: {p.skipped}</p>}
          </div>

          <div className="card suggestion">
            <div className="card-head">
              <h2>Suggested response</h2>
              <span className="tag-ai tag-notsent">SUGGESTED RESPONSE — NOT YET SENT</span>
            </div>
            {p.freshSuggestion && (
              <div className="fresh">
                A newer suggestion is available.{" "}
                <button className="btn btn-small" onClick={p.onUseFresh}>
                  Use it
                </button>
              </div>
            )}
            <textarea
              className="draft"
              value={p.draft}
              onChange={(e) => p.onDraftChange(e.target.value)}
              rows={5}
              placeholder="Edit the suggestion here before sending."
              aria-label="Suggested response, editable"
            />
            {p.suggestionReasoning && <p className="hint reasoning">{p.suggestionReasoning}</p>}
            <div className="row wrap">
              {MODES.map(({ mode, label }) => (
                <button key={mode} className="btn" onClick={() => p.onMode(mode)} disabled={disabled}>
                  {p.busy === mode ? "…" : label}
                </button>
              ))}
              <button className="btn btn-ghost" onClick={copy} disabled={!p.draft}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>

            {p.onSend && (
              <div className="send-area">
                {!confirming ? (
                  <button className="btn btn-send" onClick={() => setConfirming(true)} disabled={disabled || !p.draft.trim()}>
                    Send to {p.otherName}
                  </button>
                ) : (
                  <div className="confirm">
                    <span>Send this to {p.otherName} on WhatsApp?</span>
                    <button className="btn" onClick={() => setConfirming(false)} disabled={p.busy === "send"}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-send"
                      onClick={() => {
                        void p.onSend?.(p.draft).finally(() => setConfirming(false));
                      }}
                      disabled={p.busy === "send"}
                    >
                      {p.busy === "send" ? "Sending…" : "Yes, send it"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Ask the copilot</h2>
            </div>
            <div className="row wrap">
              {QUESTIONS.map(({ question, label }) => (
                <button
                  key={question}
                  className={`btn ${p.answer?.question === question ? "btn-active" : ""}`}
                  onClick={() => p.onAsk(question)}
                  disabled={disabled}
                >
                  {p.busy === question ? "…" : label(p.otherName)}
                </button>
              ))}
            </div>
            {p.answer && (
              <div className="answer">
                <span className="tag-ai">PRIVATE HOMEAIR ANALYSIS</span>
                <div className="answer-text">
                  {p.answer.text.split(/\n{2,}/).map((para, i) => (
                    <p key={i}>{renderInline(para)}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function renderInline(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

export function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}
