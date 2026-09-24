# HomeAIR — handover (written 2026-09-24, moving from Yoga to HP)

Read this first on a new machine. It is the state that is not derivable from the code.

## Where things stand

- **Phase 1** (paste simulator) and **Phase 2** (live WhatsApp) are built and committed. Phase 2 is the product; the simulator lives at `#/simulator`.
- The full cycle — enable chat → analysis → edit → SEND (confirm) → reply → auto-trigger → new analysis — was demonstrated end-to-end on 2026-09-12 with the **fake connector** (`WHATSAPP_CONNECTOR=fake`), against the real model via the bridge.
- The **real WhatsApp leg is unverified**: the Baileys connector reached the QR screen, but no QR was scanned on the Yoga, so real receive / chat-list sync / real send have not been exercised yet. That is the first thing to do on the HP.
- Not built, by instruction: Phase 3 rolling reconciled state, Matrix/Element X, Telegram, calendar/tasks/email, Supabase/MyPKA integration, multi-user.
- Untested: the phone layout on an actual phone; PWA install (needs https — `tailscale serve --bg 3000`).

## Getting it running on the HP

Requires Node 22+, Claude Code installed and logged in (`claude auth status`), and this repo.

```bash
git clone https://github.com/warwickallan/Homeair.git HomeAIr && cd HomeAIr
npm install
npm run setup          # creates .env from .env.example
npm run build          # web UI → apps/web/dist
npm start              # bridge :4317 (loopback) + HomeAIR :3000
```

Then open http://localhost:3000, scan the QR (WhatsApp → Linked devices → Link a device), pick one chat.

Things that are **per machine** and deliberately not in git:

- `.env` — recreate with `npm run setup`. On the Yoga it had `HOST=0.0.0.0` so the phone could reach it over Tailscale; set the same on the HP if you want that.
- `data/whatsapp-session/` — the linked-device session. You will scan a fresh QR on the HP. Unlink the Yoga's device from WhatsApp → Linked devices if you don't want two.
- `data/homeair.db` — stored messages/analyses for the enabled chat. Starts empty on the HP.
- Claude Code itself must be logged in on the HP; the bridge uses that login. No Anthropic API key is used or wanted.

## Using it from the phone

`HOST=0.0.0.0` in `.env`, restart, open `http://<HP's tailscale ip>:3000` on the Samsung (`tailscale ip -4` on the HP). Bridge stays loopback-only.

## Decisions that would otherwise look odd

- **Baileys, not whatsapp-web.js**: whatsapp-web.js needs a headless Chromium (~300–500 MB). The Yoga killed background processes for low memory repeatedly; Baileys is a WebSocket client. Same `MessagingConnector` interface either way.
- **`node:sqlite`, no ORM**: zero native build. Plain SQL in `apps/server/src/db.ts`.
- **The bridge is domain-free**: apps send `{task, system, input, schema}`; prompts stay in the app. Meant to be reused by MyPKA / CareerAIR / RAID app, and to be lifted into its own repo later.
- **No refusal fallbacks** wired into the Anthropic API provider; refusals surface as `ai_refused`. The bridge path (default) doesn't use that provider anyway.
- **Chat metadata for all chats is stored** (names, last-message time) so the picker survives restarts; message content only for the one enabled chat; switching chat deletes the previous chat's content.

## Gotchas learned the hard way

- Claude Code's `--json-schema` rejects a `$schema` key; the bridge strips it.
- Claude Code's `modelUsage` can include a Haiku side-model entry; pick the entry with the most output tokens.
- Running `claude -p` from inside a Claude Code session needs `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` removed from the child env (the bridge does this).
- Baileys addresses some chats by `@lid`; the normaliser prefers the phone jid via `remoteJidAlt`.
- WhatsApp only sends the history dump on a fresh login, so after a restart a never-enabled chat has no history until new messages arrive.
- `taskkill` under Git Bash needs `MSYS_NO_PATHCONV=1` or the `/F` gets mangled.
- Vite 7 binds `localhost` on IPv6; `curl 127.0.0.1:5173` fails while the browser works.

## Next steps, in order

1. Pair for real on the HP; enable your own "You" chat; message yourself; watch it appear, get analysed, reply from HomeAIR. Fix whatever breaks in the Baileys leg.
2. Switch the enabled chat to the real one.
3. Test on the Samsung over Tailscale; fix layout issues on a real screen.
4. Then, and only then, consider Phase 3 (rolling state) or the Matrix/Element X idea.
