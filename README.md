# GraupelClaw

GraupelClaw is a private OpenClaw workspace for agent chat, gateway management, and future session-first tooling.

This repository started from the ChatClaw codebase and is now being reshaped into an independent long-term project focused on personal OpenClaw workflows.

## Current Direction

- Keep the existing chat UI, streaming, gateway config, and workspace editing flows
- Replace generic "conversation-first" assumptions with stronger OpenClaw session support
- Grow toward a personal operator console instead of a generic multi-tenant product

## Quick Start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

If your local OpenClaw setup is available, GraupelClaw will try to detect it from `~/.openclaw/openclaw.json`.

## Configuration

Copy [`.env.example`](./.env.example) to `.env` and adjust as needed.

Key settings:

- `DB_BACKEND=indexeddb` keeps data in the browser
- `DB_BACKEND=drizzle` stores data in SQLite on the server
- `PRIVATE_OPENCLAW_CONSOLE_DATA_DIR=./data` controls the SQLite location for this project
- `AUTH_ENABLED=false` keeps the app local-only unless you want sign-in enabled
- `MULTI_COMPANY=true` keeps multiple gateway/company configs available

## Project Notes

- Branding and storage/session naming are centralized in [`src/lib/project-brand.ts`](./src/lib/project-brand.ts)
- Current UI conversations are still local app objects, not full OpenClaw-native session browsing yet
- The next major product step is to surface OpenClaw `sessions_list` and `sessions_history`

## Suggested Next Steps

1. Finish rebranding any remaining UI copy and assets.
2. Add an agent session list panel backed by OpenClaw RPC.
3. Add session history playback and session metadata.
4. Decide whether local `Conversation` remains as a cached layer or becomes a thin wrapper over native sessions.

## License

This project remains subject to the upstream MIT license terms included in [`LICENSE`](./LICENSE).
