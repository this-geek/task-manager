# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

An AI-optimized, Jira-style task management system: a Kanban board for humans, plus token-efficient JSON endpoints for autonomous AI agents to read and mutate task state. Full design is in [`docs/app-spec.md`](docs/app-spec.md) — read it before implementing anything, it's the source of truth for schema, API contracts, and guardrails.

**Current state**: specification only. No application code exists yet. When you add the first Workers/Pages scaffolding, update this file's "Commands" section with the real dev/build/test/deploy commands instead of leaving them aspirational.

## Guiding principles — read this before writing code

1. **Stay lightweight.** This is intentionally a small project: one Worker-backed API, one D1 database, one frontend. Don't introduce extra services, queues, microservices, ORMs-on-top-of-ORMs, or config layers "for later." If a simpler Cloudflare-native option covers the need, use it over a heavier third-party alternative.
2. **Cloudflare is the platform, not just a hosting choice.** Build *for* Workers, Pages, and D1 rather than porting in patterns from a traditional Node server. That means: stateless Worker handlers, D1 (SQLite) for persistence via `wrangler` migrations, Pages for the frontend, and Cloudflare-native primitives (Durable Objects, KV, Queues) only if a real requirement in the spec calls for them (e.g. § 8.2's real-time sync idea). Don't reach for AWS/GCP-style infrastructure or a separate database service — and don't reach for Cloudflare Access/Zero Trust either, since auth is deliberately handled with app-level bearer tokens (§5) instead.
3. **The UI should feel fresh and modern.** Not a dated enterprise-PM clone. Clean typography, sensible whitespace, smooth drag-and-drop, fast perceived performance, mobile-first responsiveness per spec § 6. When building UI, favor current, well-supported approaches (modern CSS — grid/flex/container queries, a lean component model) over legacy patterns.
4. **Optimize agent payloads separately from human payloads.** The `/api/agent/*` endpoints exist specifically to hand LLM callers small, purposeful JSON — don't let them balloon back into full entity dumps for convenience.
5. **Every endpoint is authenticated — no exceptions.** All `/api/*` routes require a valid `Authorization: Bearer <token>` checked against the `api_tokens` table (spec § 5): hash-lookup, reject revoked/expired tokens, enforce scope (`admin`/`human`/`agent`), rate-limit `agent`-scoped callers. Token lifecycle (issue/rotate/revoke) is admin-only, surfaced through the Settings → Tokens UI (§6.3) — never build a second, parallel way to mint credentials.
6. **Respect the guardrails in spec § 7** when touching mutation logic: circular-dependency detection on `task_dependencies`, database-owned timestamps (never trust a client-supplied `created_at`/`updated_at`/`logged_at`), HTML-stripping/sanitization on any Markdown description field, and never persisting or logging a plaintext token — only its SHA-256 hash.
7. **Treat spec § 8 as open questions, not settled decisions.** Optimistic concurrency (`version` column), real-time sync (SSE/Durable Objects), audit logging, and how a human bootstraps their *first* admin token (§8.4) are proposed enhancements/unresolved details. Ask before assuming one is in scope for a given task — implementing them speculatively is exactly the kind of premature scope this project wants to avoid.

## Architecture

```
Human UI (Cloudflare Pages) ─┐
                              ├─ HTTPS/JSON ─ Cloudflare Workers API ─ Cloudflare D1 (SQLite)
AI Agent (REST client) ──────┘
```

- **Frontend**: Cloudflare Pages. SPA/SSR framework choice (Remix, Next.js, or vanilla JS) is open — pick the lightest option that supports the Kanban + drawer + mobile bottom-sheet UI, plus the Settings → Tokens admin area, in spec § 6.
- **Backend**: Cloudflare Workers. Stateless request handlers; no in-memory session state across requests — auth state lives in `api_tokens` (D1), not in Worker memory.
- **Database**: Cloudflare D1. Schema lives in spec § 2 — `tasks`, `task_dependencies`, `task_links`, `time_logs`, `tags`, `task_tags`, `api_tokens`, plus indexes.

## Commands

Not yet established — no `wrangler.toml`/`package.json` exists in this repo yet. Once scaffolding is added, this section should list the real commands, e.g.:

- Local dev: `wrangler pages dev` / `wrangler dev`
- D1 migrations: `wrangler d1 migrations apply`
- Tests: (framework TBD)
- Deploy: `wrangler pages deploy` / `wrangler deploy`

Do not invent or run commands that aren't backed by actual project config.

## Working in this repo

- Cross-check any implementation work against `docs/app-spec.md` first — endpoint names, status enum values, field names (e.g. `estimated_time`/`actual_time` are minutes, not hours), the CTE-based cycle check, and the token validation flow (§5.2) are all specified precisely.
- Keep changes proportional to the request — this is a bug-fix/feature-add codebase, not a place for speculative abstractions or unused configuration.
- No comments explaining *what* code does; only note *why* when a constraint from the spec (e.g. a guardrail or an edge case from § 7/§ 8) makes the code non-obvious.
