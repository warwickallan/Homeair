# LLM Bridge

A tiny local service that gives applications on this machine occasional structured intelligence **without each app needing its own API account**. It turns a `(system, input, schema)` request into a controlled, tool-less Claude Code invocation using the Claude Code login that already exists, and returns validated JSON.

HomeAIR is its first customer. It has no dependency on HomeAIR and is designed to be lifted into its own repository.

```
your app ──POST /v1/generate──► bridge ──claude -p (locked down)──► Claude Code (your login)
         ◄── { ok, output, meta } ◄──────── structured_output ◄────────┘
```

## Contract

`POST http://127.0.0.1:4317/v1/generate`

```json
{
  "task": "homeair.analyse",
  "system": "instructions the calling app trusts",
  "input": "untrusted data — a transcript, a document, whatever",
  "schema": { "type": "object", "properties": { "...": {} }, "required": ["..."] },
  "model": "sonnet",
  "effort": "medium",
  "timeoutMs": 120000
}
```

`model`, `effort` and `timeoutMs` are optional. Response:

```json
{ "ok": true, "output": { "...": "matches your schema" },
  "meta": { "backend": "claude-code", "model": "claude-opus-5", "durationMs": 9876, "costUsd": 0.03, "usage": { "inputTokens": 1, "outputTokens": 2 } } }
```

Errors are `{ "ok": false, "code": "...", "error": "..." }` with a stable code: `bad_request` 400, `unauthorised` 401, `busy` / `backend_rate_limited` 429, `backend_auth` 502, `backend_error` 502, `output_invalid` 502, `backend_unavailable` 503, `timeout` 504.

`GET /v1/health` → `{ ok, backend, version, loggedIn, authMethod, detail }`.

## What the bridge guarantees

- The model runs with **no tools** (`--tools ""`), **no MCP servers** (`--strict-mcp-config`), **no hooks / CLAUDE.md / plugins** (`--safe-mode`), and **no session persistence** (`--no-session-persistence`). It cannot read files, run commands, or reach the network. It gets your `system`, your `input`, and nothing else.
- `input` goes to the child over **stdin**, never on the command line.
- The bridge **never logs** `system`, `input` or `output`. Logs carry the task label, timings, model and error codes.
- It listens on **loopback only** by default. Set `BRIDGE_TOKEN` to require a bearer token as well.
- At most `BRIDGE_MAX_CONCURRENCY` (default 2) model processes run at once; a bounded queue returns `busy` rather than piling up.

## What the caller is responsible for

- Its own prompts and schema. The bridge is domain-free.
- Re-validating `output` against its own schema (the CLI enforces the JSON Schema, but belt and braces).
- Treating its `input` as untrusted and saying so in its `system` prompt. The bridge does not rewrite prompts.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRIDGE_PORT` | `4317` | Listen port |
| `BRIDGE_HOST` | `127.0.0.1` | Bind address. Leave it. |
| `BRIDGE_BACKEND` | `claude-code` | Only backend so far |
| `BRIDGE_TOKEN` | — | If set, required as `Authorization: Bearer` |
| `BRIDGE_MAX_CONCURRENCY` | `2` | Parallel model processes |
| `BRIDGE_TIMEOUT_MS` | `120000` | Default per-request timeout |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code binary if not on PATH |

## Running

```bash
npm run dev -w apps/llm-bridge     # from the monorepo root
```

Requires Claude Code installed and logged in (`claude auth status`). It works when launched from inside a Claude Code terminal; the nested-session guard is handled.

## Adding a backend

Implement `Backend` in `src/backend.ts` (`generate`, `health`), add a file under `src/backends/`, select it with `BRIDGE_BACKEND`. Candidates: Anthropic API, Ollama, Codex.
