# HomeAIR — Relationship Copilot

A local-first personal web app that reads one explicitly allowlisted WhatsApp conversation and acts as a private communications copilot: what is this argument actually about, is it escalating, am I answering the wrong question, and what could I send instead.

> Help me communicate better. Do not impersonate me.

**Copilot, not autopilot.** HomeAIR never sends anything on its own. Every suggestion is private and editable; the only way a message leaves is the SEND button plus a confirm tap, from your own linked WhatsApp account.

**No API key.** Intelligence comes from the local [LLM Bridge](./apps/llm-bridge/README.md), which drives the Claude Code login already on this machine in a locked-down, tool-less mode. HomeAIR is the bridge's first customer; other local apps can use it too.

The full specification is in [`HomeAIR WhatsApp Relationship Copilot — Detailed Build Brief.md`](./HomeAIR%20WhatsApp%20Relationship%20Copilot%20—%20Detailed%20Build%20Brief.md).

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Conversation simulator (paste mode) — kept at `#/simulator` | Done |
| 1b | Deterministic trigger layer: routine messages never reach the model | Done |
| 2 | **Live WhatsApp**: QR pairing, chat picker, one enabled chat, live thread, auto-analysis, variants, questions, editable suggestion, manual SEND, phone layout | **Done — the product** |
| 3 | Rolling reconciled conversation state across analyses | Not started |

## Run-book

### Start it

```bash
npm install
npm run setup        # .env from .env.example (once)
npm run build        # builds the web UI into apps/web/dist
npm start            # bridge (:4317, loopback) + HomeAIR (:3000)
```

`npm run dev` is the hot-reload variant (adds Vite on :5173). For the phone, use `npm start`.

### Pair WhatsApp

Open http://localhost:3000. A QR code appears. On the phone: WhatsApp → ⋮ / Settings → **Linked devices** → **Link a device** → scan. The session is saved under `data/whatsapp-session/` so restarts don't need a rescan. `POST /api/whatsapp/logout` (or the button after a logout) clears it.

### Pick the chat

After pairing, HomeAIR lists your chats (metadata only — names and last-message times). Tap **Use this chat** on one. From then on:

- only that chat's messages are stored (`data/homeair.db`) and sent to the AI;
- up to `HISTORY_LIMIT` recent messages are imported as context — never analysed on their own;
- every other chat is ignored at the router. Changing chat deletes the previous chat's stored messages and analyses.

### Use it on the phone over Tailscale

Set `HOST=0.0.0.0` in `.env` (done by default now), restart, then open `http://<this-machine's-tailscale-ip>:3000` on the phone (`tailscale ip -4` on this machine). The bridge stays loopback-only; only HomeAIR is exposed, and only on the tailnet. Add to home screen from the browser menu.

For a proper PWA install (service worker, standalone window) the page must be served over https: `tailscale serve --bg 3000` gives you `https://<machine>.<tailnet>.ts.net` with a valid certificate.

### The cycle

She sends a message → it appears in the thread → the trigger decides whether it needs analysis (routine messages don't) → if so, after a `MESSAGE_BATCH_SECONDS` quiet period the bridge is asked → guidance and a suggested reply appear in the amber panel → edit it if you like → **Send to …** → confirm → it goes out from your WhatsApp account → her next reply appears and the cycle continues. Nothing is ever sent without that confirm tap.

## Quick start (dev)

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

The enabled chat lives in the database (`data/homeair.db`), not in `.env`. `WHATSAPP_CONNECTOR`, `HOST`, `HISTORY_LIMIT`, `MESSAGE_BATCH_SECONDS` are documented in `.env.example`.

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
  web/           Vite + React UI. Live WhatsApp screen (the product) and the simulator at #/simulator.
packages/
  shared/        Normalised Message model, Zod schemas for AI output, HTTP contract.
  conversation/  Transcript parser, Layer-A context builder, deterministic trigger layer.
  ai/            AIProvider interface; Bridge, Anthropic API and mock implementations; prompts; style profile.
  messaging/     MessagingConnector interface; Baileys (WhatsApp linked device) and fake implementations.
data/            Local-only: SQLite db and WhatsApp session. Git-ignored.
```

Packages are consumed as TypeScript source — there is no build step. `tsx` runs the servers, Vite compiles the web, Vitest runs tests.

## Privacy and safety properties

- **Nothing is sent automatically.** There is exactly one send path (`POST /api/chats/:id/send`), reachable only from the SEND button after a confirm tap. No autonomous replies, no auto-reactions, no scheduled sends.
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
