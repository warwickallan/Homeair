# HomeAIR — Relationship Copilot

A local-first personal web app that reads one explicitly allowlisted WhatsApp conversation and acts as a private communications copilot: what is this argument actually about, is it escalating, am I answering the wrong question, and what could I send instead.

> Help me communicate better. Do not impersonate me.

**Copilot, not autopilot.** HomeAIR has no ability to send messages. Every suggestion is private; you copy it into WhatsApp yourself, or you don't.

The full specification is in [`HomeAIR WhatsApp Relationship Copilot — Detailed Build Brief.md`](./HomeAIR%20WhatsApp%20Relationship%20Copilot%20—%20Detailed%20Build%20Brief.md).

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Conversation simulator: paste → analyse → suggestion, response modes, analysis questions, Stop Typing / Wrong Battle warnings | **Done** |
| 2 | WhatsApp read-only integration (QR link, chat allowlist, live messages, SQLite persistence) | Not started |
| 3 | Rolling reconciled conversation state | Not started |
| 4 | UX polish, notifications, mobile | Not started |

## Quick start

Requires Node 22+.

```bash
npm install
npm run setup          # creates .env from .env.example
# edit .env → AI_API_KEY=sk-ant-...
npm run dev            # server on :3000, web on :5173
```

Open http://localhost:5173, press **Load example**, press **Analyse**.

With no API key the server falls back to a **mock provider** (canned output) so the UI and plumbing can be exercised without spending anything. The status pill in the header tells you which one you're on.

## Configuration

All config is in `.env` at the repo root (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `mock` |
| `AI_API_KEY` | — | Anthropic API key (`ANTHROPIC_API_KEY` also works) |
| `AI_MODEL` | `claude-opus-5` | Any current Claude model id |
| `AI_EFFORT` | `high` | `low` … `max`. `medium` is noticeably faster |
| `PORT` | `3000` | API server port |
| `RECENT_MESSAGE_LIMIT` | `30` | Recent messages sent to the model per request |

The chat allowlist (Phase 2) will live in the database, not in `.env`.

## Scripts

```bash
npm run dev          # both servers with hot reload
npm run dev:server   # API only
npm run dev:web      # UI only
npm test             # vitest, all packages
npm run typecheck    # tsc across every workspace
```

## Layout

```
apps/
  server/        Fastify API. Validates, builds context, calls the provider. No reasoning here.
  web/           Vite + React UI. The simulator screen.
packages/
  shared/        Normalised Message model, Zod schemas for AI output, HTTP contract.
  conversation/  Transcript parser, Layer-A context builder. (Phase 3: rolling state.)
  ai/            AIProvider interface, Anthropic implementation, mock, prompts, style profile.
  messaging/     (Phase 2) MessagingConnector interface + whatsapp-web.js implementation.
data/            Local-only: SQLite db and WhatsApp session. Git-ignored.
```

Packages are consumed as TypeScript source — there is no build step. `tsx` runs the server, Vite compiles the web, Vitest runs tests.

## How a request flows

```
paste transcript ──► parseTranscript ──► Message[]        (web, packages/conversation)
                                            │
                              POST /api/analyse { messages }
                                            │
                                     buildContext         (last N messages, other person's name)
                                            │
                              provider.analyseConversation
                                            │
                        Claude, structured output, validated against Zod schema
                                            │
                        { analysis, suggestion } ──► UI
```

`/api/suggest` reshapes the suggestion in a mode (shorter, warmer, more direct, more like me, de-escalate, clarify). `/api/ask` answers the analysis questions (explain her view, explain my view, what are we arguing about, am I being unreasonable, what to avoid). Both are given the analysis already produced, so they don't re-analyse.

## Privacy and safety properties

- **Nothing is sent to anyone.** There is no send path in the codebase. Phase 2 is read-only by design.
- **Conversation text never enters the system prompt.** It goes to the model as data inside `<transcript>` tags in the user turn, with the trust boundary spelled out (brief §24). A test asserts this.
- **Only what you paste (or, in Phase 2, allowlist) reaches the AI.**
- **No analytics, no telemetry, no request-body logging.** The server logs method, path, status and error *codes*.
- **Model output is validated** against a schema before anything downstream sees it. Malformed output is a 502 with a code, not a crash. Tests cover this.
- **The AI provider is explicit.** `AI_PROVIDER=anthropic` means conversation text is sent to Anthropic's API. `mock` means nothing leaves the machine.

## Transcript format

```
HER: You never listen when I tell you something bothers me.
ME: That's not fair. You asked me yesterday and I literally did it.
```

`ME` / `I` / `MYSELF` are you. Any other label is the other person, and their label becomes their display name (`Jola:` works). A message can span multiple lines until the next label.

## Known limitations of the unofficial WhatsApp route (Phase 2)

`whatsapp-web.js` drives a headless Chromium against WhatsApp Web. It is not a Meta-supported integration: it can break when WhatsApp Web changes, it needs a Chromium download on first install, and linked-device automation carries a small, non-zero account-suspension risk. The connector is isolated behind an interface so it can be swapped.
