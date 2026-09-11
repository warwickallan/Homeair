# HomeAIR — Relationship Copilot

A local-first personal web app that reads one explicitly allowlisted WhatsApp conversation and acts as a private communications copilot: what is this argument actually about, is it escalating, am I answering the wrong question, and what could I send instead.

> Help me communicate better. Do not impersonate me.

**Copilot, not autopilot.** HomeAIR has no ability to send messages. Every suggestion is private; you copy it into WhatsApp yourself, or you don't.

**No API key.** Intelligence comes from the local [LLM Bridge](./apps/llm-bridge/README.md), which drives the Claude Code login already on this machine in a locked-down, tool-less mode. HomeAIR is the bridge's first customer; other local apps can use it too.

The full specification is in [`HomeAIR WhatsApp Relationship Copilot — Detailed Build Brief.md`](./HomeAIR%20WhatsApp%20Relationship%20Copilot%20—%20Detailed%20Build%20Brief.md).

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Conversation simulator: paste → analyse → suggestion, response modes, analysis questions, Stop Typing / Wrong Battle warnings — running on the real model via the bridge | **Done** |
| 1b | Deterministic trigger layer: routine messages ("👍", "on my way") never reach the model | **Done** |
| 2 | WhatsApp read-only integration (QR link, chat allowlist, live messages, SQLite persistence, batching) | Not started |
| 3 | Rolling reconciled conversation state | Not started |
| 4 | UX polish, notifications, mobile | Not started |

## Quick start

Requires Node 22+ and Claude Code installed and logged in (`claude auth status`).

```bash
npm install
npm run setup          # creates .env from .env.example (defaults are fine)
npm run dev            # bridge on :4317, API on :3000, web on :5173
```

Open http://localhost:5173, press **Load example**, press **Analyse**. The header pill shows whether the bridge is reachable and logged in.

## How a request flows

```
paste transcript ──► parseTranscript ──► Message[]                      (web, packages/conversation)
                                            │
                              POST /api/analyse { messages, force?, previousEscalation? }
                                            │
                                      evaluateTrigger  ──► routine? ──► { triggered:false, reason }   no model call
                                            │
                                       buildContext   (last N messages, other person's name)
                                            │
                              BridgeProvider: { task, system, input, schema }  ──► POST bridge /v1/generate
                                            │
                                   LLM Bridge: claude -p --tools "" --strict-mcp-config --safe-mode
                                              --no-session-persistence --json-schema …
                                            │
                              structured_output ──► Zod-validated ──► { triggered:true, analysis, suggestion } ──► UI
```

`/api/suggest` reshapes the suggestion in a mode (shorter, warmer, more direct, more like me, de-escalate, clarify). `/api/ask` answers the analysis questions. Both are given the analysis already produced, so they don't re-analyse.

## Configuration

All config is in `.env` at the repo root (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `bridge` | `bridge`, `anthropic` (needs `AI_API_KEY`) or `mock` |
| `AI_MODEL` | — | Model alias/id for the provider (`opus`, `sonnet`, …). Empty = provider default |
| `AI_EFFORT` | — | `low` … `max`. Empty = provider default |
| `BRIDGE_PORT` / `BRIDGE_URL` | `4317` | Where the bridge listens / where HomeAIR finds it |
| `BRIDGE_TOKEN` | — | Optional shared secret between HomeAIR and the bridge |
| `PORT` | `3000` | HomeAIR API port |
| `RECENT_MESSAGE_LIMIT` | `30` | Recent messages sent to the model per request |

The chat allowlist (Phase 2) will live in the database, not in `.env`.

## Scripts

```bash
npm run dev          # all three processes with hot reload
npm run dev:bridge   # LLM bridge only
npm run dev:server   # API only
npm run dev:web      # UI only
npm test             # vitest, all packages
npm run typecheck    # tsc across every workspace
```

## Layout

```
apps/
  llm-bridge/    Generic local LLM bridge. No HomeAIR dependency; can be lifted into its own repo.
  server/        HomeAIR API. Validates, runs the trigger, builds context, calls the provider.
  web/           Vite + React UI. The simulator screen.
packages/
  shared/        Normalised Message model, Zod schemas for AI output, HTTP contract.
  conversation/  Transcript parser, Layer-A context builder, deterministic trigger layer.
  ai/            AIProvider interface; Bridge, Anthropic API and mock implementations; prompts; style profile.
  messaging/     (Phase 2) MessagingConnector interface + whatsapp-web.js implementation.
data/            Local-only: SQLite db and WhatsApp session. Git-ignored.
```

Packages are consumed as TypeScript source — there is no build step. `tsx` runs the servers, Vite compiles the web, Vitest runs tests.

## Privacy and safety properties

- **Nothing is sent to anyone.** There is no send path in the codebase. Phase 2 is read-only by design.
- **The model gets the conversation and nothing else.** The bridge runs Claude Code with no tools, no MCP servers, no hooks, no CLAUDE.md, no session persistence. It cannot read files, run commands or reach the network.
- **Conversation text never enters the system prompt.** It goes to the model as data inside `<transcript>` tags in the user turn, with the trust boundary spelled out (brief §24). Tests assert this at both the provider and bridge layers.
- **Routine messages never reach the model.** The trigger layer is deterministic and its reasons are shown in the UI.
- **No analytics, no telemetry, no content logging.** HomeAIR and the bridge log method, path, status, task label, timings and error *codes*.
- **Model output is validated twice** — by Claude Code against the JSON Schema, then by Zod in HomeAIR — before anything downstream sees it. Malformed output is a 502 with a code, not a crash.
- **The provider is explicit.** `bridge` means your Claude Code login on this machine; `anthropic` means the API; `mock` means nothing leaves the box.

## Transcript format

```
HER: You never listen when I tell you something bothers me.
ME: That's not fair. You asked me yesterday and I literally did it.
```

`ME` / `I` / `MYSELF` are you. Any other label is the other person, and their label becomes their display name (`Jola:` works). A message can span multiple lines until the next label.

## Known limitations of the unofficial WhatsApp route (Phase 2)

`whatsapp-web.js` drives a headless Chromium against WhatsApp Web. It is not a Meta-supported integration: it can break when WhatsApp Web changes, it needs a Chromium download on first install, and linked-device automation carries a small, non-zero account-suspension risk. The connector is isolated behind an interface so it can be swapped.
