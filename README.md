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

## Auth

Every request requires `Authorization: Bearer <token>` — there's no anonymous access. Tokens are opaque secrets hashed (SHA-256) before storage in D1, scoped as `admin`, `human`, or `agent`, and optionally expiring. `agent`-scoped tokens are rate-limited (default 60 req/min) and can't reach the admin endpoints.

A **Settings → Tokens** admin area (`admin` scope only) covers the full lifecycle:

- **Issue** — name a token, pick a scope, optional expiry; the plaintext is shown once, then never again.
- **Rotate** — invalidates the old token and issues a replacement under the same name/scope.
- **Revoke** — immediate, no grace period.

How a human gets their *first* admin session is still an open question — see [`docs/app-spec.md § 8.4`](docs/app-spec.md#84-human-sign-in-mechanism-ambiguity). Full token model: [`docs/app-spec.md § 5`](docs/app-spec.md#5-authentication--authorization).

## UI

- **Desktop**: Kanban board with drag-and-drop, a contextual detail drawer, and global filtering (assignee/category/tags/"AI Target Mode").
- **Mobile** (`< 768px`): single-column layout with a sticky status tab bar and bottom-sheet modals.
- Design goal: clean, fast, and modern — not a dated enterprise-PM look.

## Guardrails

- **Circular dependency prevention** on `task_dependencies` writes (`422` on a detected cycle).
- **Immutable audit timestamps** — `created_at`/`updated_at`/`logged_at` are database-controlled, not client-settable.
- **Input sanitization** — Markdown allowed in descriptions; raw HTML is stripped before storage.
- **Token secrecy & rate limiting** — plaintext tokens are never stored or logged; `agent`-scoped tokens are rate-limited.

See [`docs/app-spec.md § 7`](docs/app-spec.md#7-system-integrity--ai-guardrails) for details, and [§ 8](docs/app-spec.md#8-ambiguities--recommended-enhancements-for-review) for open design questions (optimistic concurrency, real-time sync, audit trail, human sign-in bootstrap) still under consideration.

## Status

This project is in the specification stage — implementation has not started yet. See `docs/app-spec.md` for the authoritative design; this README will be updated as the Workers API, D1 schema, and frontend are built out.

## Development

_To be filled in once the Cloudflare Workers/Pages project scaffolding and D1 database are set up (e.g. `wrangler` config, local dev commands, migration commands)._

## License

MIT — see [LICENSE](LICENSE).
