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

```
   [ Human UI (Desktop/Mobile) ]        [ Autonomous AI Agent ]
                \                               //
                 \                             //
              [ HTTPS REST API / JSON Over TLS ]
                             ||
                 [ Cloudflare Workers Layer ]
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

## UI

- **Desktop**: Kanban board with drag-and-drop, a contextual detail drawer, and global filtering (assignee/category/tags/"AI Target Mode").
- **Mobile** (`< 768px`): single-column layout with a sticky status tab bar and bottom-sheet modals.
- Design goal: clean, fast, and modern — not a dated enterprise-PM look.

## Guardrails

- **Circular dependency prevention** on `task_dependencies` writes (`422` on a detected cycle).
- **Immutable audit timestamps** — `created_at`/`updated_at`/`logged_at` are database-controlled, not client-settable.
- **Input sanitization** — Markdown allowed in descriptions; raw HTML is stripped before storage.

See [`docs/app-spec.md § 6`](docs/app-spec.md#6-system-integrity--ai-guardrails) for details, and [§ 7](docs/app-spec.md#7-ambiguities--recommended-enhancements-for-review) for open design questions (optimistic concurrency, agent auth/rate-limiting, real-time sync, audit trail) still under consideration.

## Status

This project is in the specification stage — implementation has not started yet. See `docs/app-spec.md` for the authoritative design; this README will be updated as the Workers API, D1 schema, and frontend are built out.

## Development

_To be filled in once the Cloudflare Workers/Pages project scaffolding and D1 database are set up (e.g. `wrangler` config, local dev commands, migration commands)._

## License

MIT — see [LICENSE](LICENSE).
