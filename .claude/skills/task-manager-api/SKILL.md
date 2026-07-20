---
name: task-manager-api
description: Use when a task requires reading or mutating tasks in the Task Manager (a Jira-style board with an AI-agent-optimized REST API) — creating/updating tasks, checking what's actionable, logging time, managing dependencies/tags/links, from any project, not just this one. Covers auth, request/response shapes, and the guardrails (optimistic concurrency, circular-dependency rejection) callers must handle.
---

# Task Manager API

A small Cloudflare Workers API backing a Jira-style task board. This skill is for **calling** that API as a client from any project — it doesn't assume you have the Task Manager's own source checked out.

## 1. Find the base URL and a token

Look for these first, in order:

1. Environment variables in the current project: `TASK_MANAGER_API_URL` and `TASK_MANAGER_API_TOKEN` (or similar names already in use there).
2. A value the user has already given you in the conversation.
3. If neither exists, ask the user for the API's base URL and a bearer token. If they don't have a token yet, tell them: an admin issues one from the Task Manager's **Settings → Tokens** page, scope `agent`, and it's shown once at issuance — they need to paste it to you or put it in the project's env.

Never guess a URL or invent a token. Every request needs one.

## 2. Auth

Every request requires `Authorization: Bearer <token>`. Tokens are scoped:

- `agent` — read/write on `/api/tasks/*` and `/api/agent/*`. **Cannot** call `/api/admin/*`. Rate-limited to **60 requests/minute** by default — back off on `429`.
- `human` / `admin` — full access; not what you'll normally be given as an agent caller.

A `401` means the token is missing, unknown, revoked, or expired. A `403` means the token's scope doesn't cover that route — don't retry either without a different token.

## 3. The task entity

```json
{
  "id": "uuid",
  "title": "string",
  "description": "string | null",
  "status": "backlog | todo | in_progress | blocked | done",
  "due_date": "YYYY-MM-DD | null",
  "category": "string",
  "assignee": "string | null",
  "tags": ["string"],
  "links": [{ "url": "string", "label": "string" }],
  "dependencies": ["task-id", "..."],
  "estimated_time": 0,
  "actual_time": 0,
  "version": 1,
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

`estimated_time`/`actual_time` are **minutes**, not hours. `dependencies` lists the task IDs that block this task (this task is blocked *by* them). `created_at`/`updated_at`/`version` are server-owned — don't send them on create, and only ever send `version` back as the precondition on `PATCH` (see §5).

## 4. Endpoints

### Standard REST (`/api/tasks`)

| Method & path | Purpose |
| :--- | :--- |
| `GET /api/tasks?status=&assignee=&category=` | List/filter tasks (all filters optional, all are exact-match) |
| `POST /api/tasks` | Create a task. Only `title` is required. |
| `GET /api/tasks/:id` | Full detail, including `time_logs` (list omits this for payload size) |
| `PATCH /api/tasks/:id` | Partial update — **`version` is required in the body**, see §5 |
| `DELETE /api/tasks/:id` | Delete |
| `POST /api/tasks/:id/time-logs` | `{ "duration": <minutes>, "notes": "optional" }` |

### Agent-optimized (`/api/agent`) — prefer these for read-heavy checks; smaller payloads than `/api/tasks`

| Path | Returns |
| :--- | :--- |
| `GET /api/agent/agenda` | Tasks due today or overdue, not done, sorted soonest-first |
| `GET /api/agent/actionable` | Tasks in `todo`/`in_progress` with no incomplete dependency — i.e. safe to start now |
| `GET /api/agent/blocked` | Blocked tasks, each with a `blocked_by` array naming the actual root-cause blocker(s) |

These return lean objects (`id`, `title`, `status`, `due_date`, `category`, `assignee`, `estimated_time`, plus `blocked_by` on the blocked endpoint) — no `description`, `tags`, `links`, or `dependencies`. Call `GET /api/tasks/:id` if you need the full entity for one you found this way.

## 5. Optimistic concurrency on `PATCH` — read this before writing an update loop

Every `PATCH` body must include the `version` you last saw for that task:

```bash
curl -X PATCH "$TASK_MANAGER_API_URL/api/tasks/$ID" \
  -H "Authorization: Bearer $TASK_MANAGER_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"version": 3, "status": "in_progress"}'
```

- Match → the update applies, the response is the updated entity with `version` incremented.
- Mismatch → `409 Conflict`, body is `{"error": "...", "current": <latest entity>}`. **Re-fetch (the response already gives you the current entity), decide whether your change still makes sense against the new state, and retry with the new `version`.** Don't just resend the same version.

Only send the fields you're actually changing — you don't need to round-trip every field. Setting `tags`, `links`, or `dependencies` **replaces the whole array**, it doesn't merge; read the current array first if you're adding one item to it.

## 6. Circular dependencies

Setting `dependencies` to a set that would create a cycle (directly or transitively) returns `422` with an explanatory message — this includes a task naming itself. Don't retry the same set; either drop the offending ID or reconsider which task should really depend on which.

## 7. Content rules

- `description` accepts Markdown; raw HTML tags are stripped server-side before storage, so don't rely on HTML rendering in it.
- `due_date` is a plain `YYYY-MM-DD` string, no time component.

## 8. Error summary

| Status | Meaning | What to do |
| :--- | :--- | :--- |
| `400` | Bad request body (e.g. missing `version` on `PATCH`, invalid enum) | Fix the payload |
| `401` | Missing/invalid/revoked/expired token | Get a new token, don't retry with the same one |
| `403` | Token scope doesn't cover this route | Wrong token type — needs `admin` for `/api/admin/*` |
| `404` | Task doesn't exist | — |
| `409` | Stale `version` on `PATCH` | Re-fetch (entity is in the response), retry with new `version` |
| `422` | Circular dependency, or an unknown dependency task ID | Fix the `dependencies` array |
| `429` | Rate limit (60 req/min default for `agent` scope) | Back off and retry later |

## 9. Example: pick up the next actionable task and log progress

```bash
BASE="$TASK_MANAGER_API_URL"
AUTH="Authorization: Bearer $TASK_MANAGER_API_TOKEN"

# 1. What can I start right now?
curl -s "$BASE/api/agent/actionable" -H "$AUTH"

# 2. Move it to in_progress (need the current version first)
TASK=$(curl -s "$BASE/api/tasks/$ID" -H "$AUTH")
VERSION=$(echo "$TASK" | jq .version)
curl -s -X PATCH "$BASE/api/tasks/$ID" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"version\": $VERSION, \"status\": \"in_progress\"}"

# 3. Log time as you work
curl -s -X POST "$BASE/api/tasks/$ID/time-logs" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"duration": 25, "notes": "Investigated root cause"}'

# 4. Mark it done (use the version from step 3's response, not step 2's)
curl -s -X PATCH "$BASE/api/tasks/$ID" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"version\": <latest-version>, \"status\": \"done\"}"
```
