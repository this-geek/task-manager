# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

An AI-optimized, Jira-style task management system: a Kanban board for humans, plus token-efficient JSON endpoints for autonomous AI agents to read and mutate task state. Full design is in [`docs/app-spec.md`](docs/app-spec.md) — read it before implementing anything, it's the source of truth for schema, API contracts, and guardrails.

**Current state**: implemented. `worker/` is the Cloudflare Workers API (Hono + D1 + a Durable Object for realtime), `frontend/` is the Cloudflare Pages SPA (Vite + React + TypeScript). Cross-check `docs/app-spec.md` before changing endpoint contracts, schema, or guardrail behavior — it remains the source of truth this implementation was built against.

## Guiding principles — read this before writing code

1. **Stay lightweight.** This is intentionally a small project: one Worker-backed API, one D1 database, one frontend. Don't introduce extra services, queues, microservices, ORMs-on-top-of-ORMs, or config layers "for later." If a simpler Cloudflare-native option covers the need, use it over a heavier third-party alternative.
2. **Cloudflare is the platform, not just a hosting choice.** Build *for* Workers, Pages, and D1 rather than porting in patterns from a traditional Node server. That means: stateless Worker handlers, D1 (SQLite) for persistence via `wrangler` migrations, Pages for the frontend, and Cloudflare-native primitives (Durable Objects, KV, Queues) only if a real requirement in the spec calls for them (e.g. § 8.2's real-time sync idea). Don't reach for AWS/GCP-style infrastructure or a separate database service — and don't reach for Cloudflare Access/Zero Trust either, since auth is deliberately handled with app-level bearer tokens (§5) instead.
3. **The UI should feel fresh and modern.** Not a dated enterprise-PM clone. Clean typography, sensible whitespace, smooth drag-and-drop, fast perceived performance, mobile-first responsiveness per spec § 6. When building UI, favor current, well-supported approaches (modern CSS — grid/flex/container queries, a lean component model) over legacy patterns.
4. **Optimize agent payloads separately from human payloads.** The `/api/agent/*` endpoints exist specifically to hand LLM callers small, purposeful JSON — don't let them balloon back into full entity dumps for convenience.
5. **Every endpoint is authenticated — no exceptions.** All `/api/*` routes require a valid `Authorization: Bearer <token>` checked against the `api_tokens` table (spec § 5): hash-lookup, reject revoked/expired tokens, enforce scope (`admin`/`human`/`agent`), rate-limit `agent`-scoped callers. Token lifecycle (issue/rotate/revoke) is admin-only, surfaced through the Settings → Tokens UI (§6.3) — never build a second, parallel way to mint credentials.
6. **Respect the guardrails in spec § 7** when touching mutation logic: circular-dependency detection on `task_dependencies`, database-owned timestamps (never trust a client-supplied `created_at`/`updated_at`/`logged_at`), HTML-stripping/sanitization on any Markdown description field, and never persisting or logging a plaintext token — only its SHA-256 hash.
7. **Spec § 8 has been decided for this build — all four are implemented.** Optimistic concurrency (`tasks.version`, required on `PATCH`, `409` on mismatch), real-time sync (a `RealtimeHub` Durable Object broadcasting over SSE at `GET /api/events`), audit logging (`audit_trail` table, written alongside every mutation), and the human sign-in bootstrap (§8.4, resolved as a `SETUP_TOKEN`-gated `POST /api/setup` that mints the first admin token and refuses once one exists) are all real, shipped behavior — not proposals. Don't re-litigate whether they're in scope; do keep them working when you touch adjacent code. If a *new* enhancement beyond these four comes up, treat it the way § 8 originally asked: ask before assuming it's in scope.

## Architecture

```
Human UI (Cloudflare Pages, React SPA) ─┐
                                         ├─ HTTPS/JSON ─ Cloudflare Workers API (Hono) ─ Cloudflare D1 (SQLite)
AI Agent (REST client) ─────────────────┘                        │
                                                     Durable Object (RealtimeHub) ─ SSE ─ Human UI
```

- **Frontend** (`frontend/`): Vite + React + TypeScript SPA on Cloudflare Pages. Plain modern CSS (no UI framework) — see `src/styles/global.css`. Routes: `/` (board), `/sign-in`, `/settings/tokens`.
- **Backend** (`worker/`): Cloudflare Workers, routed with Hono (`src/index.ts` mounts `src/routes/*`). Stateless request handlers; no in-memory session state across requests — auth state lives in `api_tokens` (D1), not in Worker memory. Zod validates request bodies.
- **Database**: Cloudflare D1. Schema + migrations in `worker/migrations/` — `tasks` (incl. `version` for OCC), `task_dependencies`, `task_links`, `time_logs`, `tags`, `task_tags`, `api_tokens`, `audit_trail`, plus indexes.
- **Realtime**: a single global `RealtimeHub` Durable Object (`worker/src/durable-objects/realtime-hub.ts`) holds open SSE connections and fans out `task.created`/`task.updated`/`task.deleted` events. `GET /api/events` takes its bearer token as a query param (not a header) since `EventSource` can't set custom headers.
- **Rate limiting**: Cloudflare's native Rate Limiting binding (`AGENT_RATE_LIMITER` in `wrangler.toml`), not a hand-rolled D1-backed counter.

## Commands

```bash
# Worker API (worker/)
npm run dev                # wrangler dev
npm run db:migrate:local   # apply D1 migrations locally
npm test                   # vitest, @cloudflare/vitest-pool-workers
npm run typecheck
npm run deploy             # wrangler deploy

# Frontend SPA (frontend/)
npm run dev                # vite dev
npm run build               # tsc --noEmit && vite build
npm run typecheck
npm run deploy              # wrangler pages deploy dist
```

See the root `README.md` for the full local setup (secrets, first-run bootstrap).

## Working in this repo

- Cross-check any implementation work against `docs/app-spec.md` first — endpoint names, status enum values, field names (e.g. `estimated_time`/`actual_time` are minutes, not hours), and the token validation flow (§5.2) are all specified precisely.
- The circular-dependency guard (`worker/src/lib/cycle-check.ts`) is the **in-memory** variant spec §7.1 explicitly allows, not a CTE: `PATCH` replaces a task's whole dependency set in one call, so edges added within the same request have to be checked against each other too, not just against what's already committed — a single CTE query per edge would miss that.
- OCC (`tasks.version`) is required on every `PATCH` body; a mismatch returns `409` with the current entity so the caller can re-fetch and retry.
- Every mutation route writes to `audit_trail` in the same `db.batch()` as the mutation itself, and publishes a realtime event via `publishTaskEvent()` — keep both when adding new mutation endpoints.
- Durable Object gotcha: never `await` a `writer.write(...)` on a fresh `TransformStream` before returning the `Response` — it only resolves once a reader attaches, so awaiting it deadlocks the handler. Fire-and-forget with `.catch()` instead (see `realtime-hub.ts`).
- Keep changes proportional to the request — this is a bug-fix/feature-add codebase, not a place for speculative abstractions or unused configuration.
- No comments explaining *what* code does; only note *why* when a constraint from the spec (e.g. a guardrail or an edge case from § 7/§ 8) makes the code non-obvious.
