# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

An AI-optimized, Jira-style task management system: a Kanban board for humans, plus token-efficient JSON endpoints for autonomous AI agents to read and mutate task state. Full design is in [`docs/app-spec.md`](docs/app-spec.md) — read it before implementing anything, it's the source of truth for schema, API contracts, and guardrails.

**Current state**: specification only. No application code exists yet. When you add the first Workers/Pages scaffolding, update this file's "Commands" section with the real dev/build/test/deploy commands instead of leaving them aspirational.

## Guiding principles — read this before writing code

1. **Stay lightweight.** This is intentionally a small project: one Worker-backed API, one D1 database, one frontend. Don't introduce extra services, queues, microservices, ORMs-on-top-of-ORMs, or config layers "for later." If a simpler Cloudflare-native option covers the need, use it over a heavier third-party alternative.
2. **Cloudflare is the platform, not just a hosting choice.** Build *for* Workers, Pages, and D1 rather than porting in patterns from a traditional Node server. That means: stateless Worker handlers, D1 (SQLite) for persistence via `wrangler` migrations, Pages for the frontend, and Cloudflare-native primitives (Durable Objects, KV, Queues) only if a real requirement in the spec calls for them (e.g. § 7.3's real-time sync idea). Don't reach for AWS/GCP-style infrastructure or a separate database service.
3. **The UI should feel fresh and modern.** Not a dated enterprise-PM clone. Clean typography, sensible whitespace, smooth drag-and-drop, fast perceived performance, mobile-first responsiveness per spec § 5. When building UI, favor current, well-supported approaches (modern CSS — grid/flex/container queries, a lean component model) over legacy patterns.
4. **Optimize agent payloads separately from human payloads.** The `/api/agent/*` endpoints exist specifically to hand LLM callers small, purposeful JSON — don't let them balloon back into full entity dumps for convenience.
5. **Respect the guardrails in spec § 6** when touching mutation logic: circular-dependency detection on `task_dependencies`, database-owned timestamps (never trust a client-supplied `created_at`/`updated_at`/`logged_at`), and HTML-stripping/sanitization on any Markdown description field.
6. **Treat spec § 7 as open questions, not settled decisions.** Optimistic concurrency (`version` column), agent auth/rate-limiting, real-time sync (SSE/Durable Objects), and audit logging are proposed enhancements. Ask before assuming one is in scope for a given task — implementing them speculatively is exactly the kind of premature scope this project wants to avoid.

## Architecture

```
Human UI (Cloudflare Pages) ─┐
                              ├─ HTTPS/JSON ─ Cloudflare Workers API ─ Cloudflare D1 (SQLite)
AI Agent (REST client) ──────┘
```

- **Frontend**: Cloudflare Pages. SPA/SSR framework choice (Remix, Next.js, or vanilla JS) is open — pick the lightest option that supports the Kanban + drawer + mobile bottom-sheet UI in spec § 5.
- **Backend**: Cloudflare Workers. Stateless request handlers; no in-memory session state across requests.
- **Database**: Cloudflare D1. Schema lives in spec § 2 — `tasks`, `task_dependencies`, `task_links`, `time_logs`, `tags`, `task_tags`, plus indexes.

## Commands

Not yet established — no `wrangler.toml`/`package.json` exists in this repo yet. Once scaffolding is added, this section should list the real commands, e.g.:

- Local dev: `wrangler pages dev` / `wrangler dev`
- D1 migrations: `wrangler d1 migrations apply`
- Tests: (framework TBD)
- Deploy: `wrangler pages deploy` / `wrangler deploy`

Do not invent or run commands that aren't backed by actual project config.

## Working in this repo

- Cross-check any implementation work against `docs/app-spec.md` first — endpoint names, status enum values, field names (e.g. `estimated_time`/`actual_time` are minutes, not hours), and the CTE-based cycle check are all specified precisely.
- Keep changes proportional to the request — this is a bug-fix/feature-add codebase, not a place for speculative abstractions or unused configuration.
- No comments explaining *what* code does; only note *why* when a constraint from the spec (e.g. a guardrail or an edge case from § 6/§ 7) makes the code non-obvious.
