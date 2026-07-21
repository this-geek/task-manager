# Task Manager

A lightweight, ultra-low-latency task management system with a Jira-style board for humans and a token-efficient JSON API for autonomous AI agents.

This is a **small, edge-native project by design** — no servers to manage, no heavyweight framework stack, and no infrastructure beyond Cloudflare's free/low-cost primitives. It's meant to stay simple and fast, not grow into a sprawling PM suite.

> 📄 Full technical specification: [`docs/app-spec.md`](docs/app-spec.md)

## Why this exists

Most task trackers are built for humans clicking around a UI. This one is built for a world where humans *and* AI agents both read and mutate task state — so the API is designed to serve small, purpose-shaped JSON payloads to agents (`/api/agent/agenda`, `/api/agent/actionable`, `/api/agent/blocked`) instead of forcing them to parse a full UI-oriented response.

## Stack

Everything runs on Cloudflare — no separate hosting, no containers, no dedicated database server.

| Layer | Technology |
| :--- | :--- |
| Frontend | SPA/SSR (Remix, Next.js, or vanilla JS) on **Cloudflare Pages**, with a fresh, modern UI |
| Backend | **Cloudflare Workers** — stateless API routing, validation, LLM-optimized formatting |
| Database | **Cloudflare D1** (SQLite at the edge) |
| Auth | Bearer tokens, validated at the Worker layer against D1 |

```
   [ Human UI (Desktop/Mobile) ]        [ Autonomous AI Agent ]
                \                               //
                 \                             //
              [ HTTPS REST API / JSON Over TLS ]
                             ||
                 [ Cloudflare Workers Layer ]
                      (bearer token check)
                             ||
                 [ Cloudflare D1 (SQLite) ]
```

## Data model

Tasks are the core entity, with supporting tables for dependencies, links, time logs, and tags. See the full schema in [`docs/app-spec.md § 2`](docs/app-spec.md#2-database-schema-cloudflare-d1-sqlite).

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUIDv4 | Primary key |
| `title` / `description` | string | Markdown-supported description |
| `status` | enum | `backlog`, `todo`, `in_progress`, `blocked`, `done` |
| `category` | string | Work stream grouping |
| `assignee` | string | Human or AI agent identifier |
| `tags` | string[] | Taxonomy filters |
| `links` | object[] | `{ url, label }` |
| `dependencies` | string[] | Task IDs blocking this task |
| `estimated_time` / `actual_time` | int (minutes) | Planned vs. logged |

## API

### Standard REST

- `GET /api/tasks` — list/filter tasks (`?status=`, `?assignee=`, `?category=`)
- `POST /api/tasks` — create a task
- `GET /api/tasks/:id` — full task detail (logs, links, tags, dependencies)
- `PATCH /api/tasks/:id` — partial update
- `DELETE /api/tasks/:id` — delete/archive
- `POST /api/tasks/:id/time-logs` — log time (`{ duration, notes }`)

### Agent-optimized

- `GET /api/agent/agenda` — tasks due now or overdue, not done
- `GET /api/agent/actionable` — tasks ready to work on right now (no incomplete dependencies)
- `GET /api/agent/blocked` — tasks blocked, with root-blocker metadata

These endpoints exist to strip presentation-layer noise and minimize context-window usage for LLM callers.

### MCP server

- `POST /api/mcp` — a remote [Model Context Protocol](https://modelcontextprotocol.io) server (Streamable HTTP, stateless) that exposes the board to any MCP client (Claude Desktop, Cursor, custom agents) as typed tools: `list_tasks`, `get_task`, `agenda`, `actionable`, `blocked`, `create_task`, `update_task`, `delete_task`, `log_time`.

It's a thin transport shim over the endpoints above — same bearer tokens, same guardrails, no separate task logic. It's **off by default**; an admin turns it on (and can restrict it to read-only) under **Settings → MCP**. To connect a client, point it at `<your-api-url>/api/mcp` and authenticate with an `agent`-scoped token as the `Authorization: Bearer <token>` header. See [`docs/app-spec.md § 9`](docs/app-spec.md#9-mcp-server-decided-enhancement).

## Auth

Every request requires `Authorization: Bearer <token>` — there's no anonymous access. Tokens are opaque secrets hashed (SHA-256) before storage in D1, scoped as `admin`, `human`, or `agent`, and optionally expiring. `agent`-scoped tokens are rate-limited (default 60 req/min) and can't reach the admin endpoints.

A **Settings → Tokens** admin area (`admin` scope only) covers the full lifecycle:

- **Issue** — name a token, pick a scope, optional expiry; the plaintext is shown once, then never again.
- **Rotate** — invalidates the old token and issues a replacement under the same name/scope.
- **Revoke** — immediate, no grace period.

A human gets their *first* admin token via a one-time setup-secret exchange: the Worker is deployed with a `SETUP_TOKEN` secret, and `POST /api/setup` (with that secret as the bearer token) mints the first admin token — then refuses forever after (§8.4 in the spec, resolved this way for this build). Full token model: [`docs/app-spec.md § 5`](docs/app-spec.md#5-authentication--authorization).

## UI

- **Desktop**: Kanban board with drag-and-drop, a contextual detail drawer, and global filtering (assignee/category/tags/"AI Target Mode").
- **Mobile** (`< 768px`): single-column layout with a sticky status tab bar and bottom-sheet modals.
- Design goal: clean, fast, and modern — not a dated enterprise-PM look.

## Guardrails

- **Circular dependency prevention** on `task_dependencies` writes (`422` on a detected cycle).
- **Immutable audit timestamps** — `created_at`/`updated_at`/`logged_at` are database-controlled, not client-settable.
- **Input sanitization** — Markdown allowed in descriptions; raw HTML is stripped before storage.
- **Token secrecy & rate limiting** — plaintext tokens are never stored or logged; `agent`-scoped tokens are rate-limited.

See [`docs/app-spec.md § 7`](docs/app-spec.md#7-system-integrity--ai-guardrails) for details. The § 8 enhancements are all implemented in this build:

- **Optimistic concurrency** (§8.1) — `tasks.version` is required on every `PATCH`; a stale version gets `409` back with the current entity.
- **Real-time sync** (§8.2) — a Durable Object fans out task change events over SSE (`GET /api/events`); the board updates live without a refresh.
- **Audit trail** (§8.3) — every mutation writes an `audit_trail` row (actor, action, field, old/new value).
- **Human sign-in bootstrap** (§8.4) — the setup-secret exchange described above.

## Status

Implemented: D1 schema + migrations, the full Workers API (`worker/`), and the React/Vite frontend (`frontend/`) — Kanban board, drawer, mobile layout, Settings → Tokens and Settings → MCP admin.

## Development

Two independent Cloudflare projects: `worker/` (Workers API + D1 + Durable Object) and `frontend/` (Pages SPA).

```bash
# Worker API
cd worker
npm install
wrangler secret put SETUP_TOKEN         # or add SETUP_TOKEN to .dev.vars for local dev
npm run db:migrate:local                # apply D1 migrations locally
npm run dev                             # wrangler dev, http://localhost:8787
npm test                                # vitest (Workers pool)
npm run deploy                          # wrangler deploy

# Frontend SPA
cd frontend
npm install
cp .env.example .env.local              # point VITE_API_BASE_URL at the Worker
npm run dev                             # vite dev, http://localhost:5173
npm run build                           # typecheck + production build
npm run deploy                          # wrangler pages deploy dist
```

First-run bootstrap: with the Worker running, `POST /api/setup` with `Authorization: Bearer <SETUP_TOKEN>` mints the first admin token (or use the frontend's "First-time setup" tab on the sign-in screen).

## Deployment

Requires a Cloudflare account and the `wrangler` CLI logged in (`wrangler login`). Deploy the Worker API first, then the frontend, since the frontend needs the Worker's URL.

### 1. Create the D1 database

```bash
cd worker
npx wrangler d1 create task_manager_db
```

Copy the `database_id` from the output into `worker/wrangler.toml` (`[[d1_databases]] database_id = "..."`, currently `REPLACE_WITH_D1_DATABASE_ID`).

### 2. Apply migrations to the remote database

```bash
npm run db:migrate:remote
```

### 3. Set the setup secret

Generate a strong random value and store it as a Worker secret — this is what mints the first admin token, so keep it private:

```bash
npx wrangler secret put SETUP_TOKEN
```

### 4. Deploy the Worker

```bash
npm run deploy
```

This also provisions the `RealtimeHub` Durable Object and the agent rate limiter — both are declared in `wrangler.toml`, no extra setup needed. Note the deployed URL (a `*.workers.dev` subdomain, or your custom domain/route if configured in the Cloudflare dashboard).

### 5. Deploy the frontend

```bash
cd ../frontend
echo "VITE_API_BASE_URL=https://<your-worker-url>" > .env.production
npm run build
npm run deploy
```

(Alternatively, connect this repo to a Cloudflare Pages project in the dashboard for git-based deploys — set `VITE_API_BASE_URL` as a Pages build environment variable instead of `.env.production`, and set the build command/output directory to `npm run build` / `dist`.)

### 6. Lock down CORS (optional but recommended)

`worker/wrangler.toml`'s `ALLOWED_ORIGIN` var defaults to `"*"`. Once you know the Pages URL, set it explicitly and redeploy the Worker:

```bash
cd ../worker
# edit wrangler.toml: ALLOWED_ORIGIN = "https://your-pages-url.pages.dev"
npm run deploy
```

### 7. Bootstrap the first admin token

Open the deployed frontend URL, use the "First-time setup" tab, and paste the `SETUP_TOKEN` value from step 3 (or call `POST /api/setup` directly with `Authorization: Bearer <SETUP_TOKEN>`). This works exactly once — the endpoint refuses once any admin token exists. Sign in with the returned token, then use Settings → Tokens to issue tokens for other humans and AI agents.

## License

MIT — see [LICENSE](LICENSE).
