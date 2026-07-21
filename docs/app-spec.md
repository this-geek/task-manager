# Technical Specification: AI-Optimized Task Management System (Jira-Style)

## 1. System Architecture Overview

This specification details a lightweight, ultra-low latency, serverless task management system. The platform provides a responsive, Jira-style visual interface for human users while serving optimized JSON payloads tailored for autonomous AI agents.

### Core Stack
*   **Frontend**: Single Page Application (SPA) or Server-Side Rendered (SSR) framework (e.g., Remix, Next.js, or solid vanilla JS) hosted on **Cloudflare Pages**.
*   **Backend**: **Cloudflare Workers** providing stateless API routing, schema validation, and specialized context formatting for Large Language Models (LLMs).
*   **Database**: **Cloudflare D1**, a distributed native SQLite database engine running at the edge.
*   **Auth**: Bearer-token authentication, validated at the Worker layer against Cloudflare D1. See §5 for the token model and the admin UI used to issue, rotate, and revoke tokens.

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

Every request into the Workers layer is authenticated before any routing or database logic runs — there is no unauthenticated path to task data. See §5.2 for the exact validation flow.

---

## 2. Database Schema (Cloudflare D1 SQLite)

The relational schema is structured to maintain strict data integrity for concurrent operations while minimizing join overhead for edge computations.

```sql
-- Core Tasks Table
CREATE TABLE tasks (
    id TEXT PRIMARY KEY, -- UUIDv4
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK(status IN ('backlog', 'todo', 'in_progress', 'blocked', 'done')),
    category TEXT NOT NULL DEFAULT 'General',
    assignee TEXT, -- User identifier (email or unique string)
    estimated_time INT DEFAULT 0, -- Stored explicitly in minutes
    due_date TEXT, -- ISO 8601 Date String (YYYY-MM-DD)
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Task Dependencies (Self-referencing Many-to-Many Relationship)
CREATE TABLE task_dependencies (
    task_id TEXT,
    blocked_by_task_id TEXT,
    PRIMARY KEY (task_id, blocked_by_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_by_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Hyperlinks Associated with Task Cards
CREATE TABLE task_links (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    url TEXT NOT NULL,
    label TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Time Tracking Logs
CREATE TABLE time_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    duration INT NOT NULL, -- Logged segment in minutes
    notes TEXT,
    logged_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Normalized Tags
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

-- Many-to-Many Mapping for Tasks and Tags
CREATE TABLE task_tags (
    task_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (task_id, tag_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- API Tokens (bearer-token auth for both human sessions and AI agents)
CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY, -- UUIDv4
    name TEXT NOT NULL, -- Human-readable label, e.g. "Claude Agent - Prod"
    token_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of the secret; plaintext is never stored
    token_prefix TEXT NOT NULL, -- First 8 chars of the plaintext, shown in the admin UI for identification
    scope TEXT NOT NULL CHECK(scope IN ('admin', 'human', 'agent')),
    created_by TEXT, -- Identifier of the admin who issued the token
    expires_at TEXT, -- Optional ISO 8601 expiry; NULL = no expiry
    last_used_at TEXT,
    revoked_at TEXT, -- NULL while active
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Indexing for Query Optimization
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX idx_task_dependencies_blocked ON task_dependencies(blocked_by_task_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
```

---

## 3. Core Card Attributes & Data Model

To facilitate predictable serialization and parsing by human UI components and LLM json-mode schemas, every task is represented by a standardized JSON entity structure.

| Attribute | Data Type | Database Mapping | Description |
| :--- | :--- | :--- | :--- |
| `id` | String (UUIDv4) | `tasks.id` | Globally unique identifier. |
| `title` | String | `tasks.title` | Single-line clear summary of work. |
| `description` | String | `tasks.description` | Markdown-supported multi-line scope layout. |
| `status` | String (Enum) | `tasks.status` | State machine constraints: `backlog`, `todo`, `in_progress`, `blocked`, `done`. |
| `due_date` | String (Date) | `tasks.due_date` | Date marker formatted as `YYYY-MM-DD`. |
| `category` | String | `tasks.category` | Primary work stream grouping. |
| `assignee` | String | `tasks.assignee` | Human actor or AI agent entity reference. |
| `tags` | Array of Strings| `task_tags` $
ightarrow$ `tags` | Descriptive taxonomy filters. |
| `links` | Array of Objects| `task_links` | Dynamic external connections: `[{"url": "...", "label": "..."}]`. |
| `dependencies` | Array of Strings| `task_dependencies` | Collection of `task_id` markers currently blocking this task. |
| `estimated_time`| Integer | `tasks.estimated_time` | Target allocation length specified in **minutes**. |
| `actual_time` | Integer | Calculated | Aggregate run-time sum of related `time_logs.duration`. |

---

## 4. AI-Agent Optimized API Specification

The REST API balances traditional HTTP verbs for standard mutation alongside semantic context routing designed to minimize context-window consumption for LLMs.

All endpoints below require a valid bearer token (`Authorization: Bearer <token>`) as described in §5. `human`- and `admin`-scoped tokens may call every endpoint in this section; `agent`-scoped tokens are restricted to this section only (never `/api/admin/*`).

### 4.1 Standard REST Endpoints
*   `GET /api/tasks` - Query tasks with optional matrix filters (`?status=`, `?assignee=`, `?category=`).
*   `POST /api/tasks` - Initialize a new card element.
*   `GET /api/tasks/:id` - Fetch full granular entity details including arrays of logs, links, and tags.
*   `PATCH /api/tasks/:id` - Perform partial item updates (e.g., status shifting, timeline updates).
*   `DELETE /api/tasks/:id` - Destructive deletion / soft archive execution.
*   `POST /api/tasks/:id/time-logs` - Log operational intervals (`{"duration": 30, "notes": "Text"}`).

### 4.2 Specialized Agent Intent Endpoints
These endpoints optimize token usage by stripping presentation layers and filtering database tuples via targeted engine-level operations before generating the response.

#### `GET /api/agent/agenda`
*   **Target Scope**: Identifies immediate operational commitments.
*   **Selection Logic**: `due_date <= CURRENT_DATE` AND `status NOT IN ('done')`. Sorted explicitly by ascending date boundaries.

#### `GET /api/agent/actionable`
*   **Target Scope**: Identifies elements ready for immediate execution.
*   **Selection Logic**: `status IN ('todo', 'in_progress')` AND `id NOT IN (SELECT task_id FROM task_dependencies JOIN tasks ON task_dependencies.blocked_by_task_id = tasks.id WHERE tasks.status != 'done')`.

#### `GET /api/agent/blocked`
*   **Target Scope**: Unmasks system bottlenecks requiring administrative structural remediation or automated execution context review.
*   **Selection Logic**: `status = 'blocked'` OR any incomplete task containing an active incomplete link inside the dependency map. Returns nested metadata indicating the root blockers.

---

## 5. Authentication & Authorization

All API traffic is authenticated with a bearer token — there is no anonymous access to task data. The same validation path is used for human UI sessions and AI agents alike, keeping the Worker's auth logic single-purpose and easy to reason about.

### 5.1 Token Model
*   Every caller presents `Authorization: Bearer <token>`.
*   Tokens are opaque, high-entropy secrets (32 random bytes, url-safe base64/base62 encoded) with a human-identifiable prefix, e.g. `tm_live_9f3a2c1d...`.
*   The Worker never stores plaintext. Only a SHA-256 hash (`api_tokens.token_hash`) is persisted; the plaintext is revealed exactly once, at issuance or rotation time, in the admin UI response.
*   Each token carries a `scope`:
    *   `admin` — manages tokens via §5.3, plus everything `human` can do.
    *   `human` — full read/write access to `/api/tasks/*` via the UI.
    *   `agent` — read/write access to `/api/tasks/*` and `/api/agent/*`; explicitly excluded from `/api/admin/*`.

### 5.2 Request Validation Flow
1.  The Worker extracts the bearer token, computes its SHA-256 hash, and looks it up in `api_tokens`.
2.  Returns `401 Unauthorized` if there is no match, `revoked_at IS NOT NULL`, or `expires_at` has passed.
3.  Returns `403 Forbidden` if the token's `scope` doesn't cover the requested route (e.g. an `agent` token calling `/api/admin/tokens`).
4.  On success, updates `last_used_at` (best-effort, non-blocking) and attaches the token's `id` and `scope` to the request context as the `actor_id` used for audit purposes (§8.3).
5.  Enforces per-token rate limiting — default **60 requests/minute** for `agent`-scoped tokens — returning `429 Too Many Requests` when exceeded.

### 5.3 Admin Token Management Endpoints
Restricted to `admin`-scoped tokens; all other scopes receive `403 Forbidden`.

*   `GET /api/admin/tokens` - List tokens: `id`, `name`, `token_prefix`, `scope`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`. Never returns `token_hash` or plaintext.
*   `POST /api/admin/tokens` - Issue a new token. Body: `{"name": "...", "scope": "agent" | "human" | "admin", "expires_at": "..."}` (expiry optional). Response includes the **plaintext token exactly once**.
*   `POST /api/admin/tokens/:id/rotate` - Revokes the existing token and issues a replacement under the same `name`/`scope`. Returns the new plaintext once; the old token is invalid immediately.
*   `DELETE /api/admin/tokens/:id` - Revoke immediately (sets `revoked_at`). The row is retained, not deleted, to preserve audit history.

### 5.4 Human Sign-In (Open Question)
How a human first obtains an `admin`- or `human`-scoped session — password, magic link, Cloudflare Access, etc. — is intentionally left open; see §8.4. Whatever mechanism is chosen should ultimately resolve to the same bearer-token validation path described in §5.2, so the Worker has one auth code path regardless of actor type.

---

## 6. UI/UX Functional Interface Requirements

The user interface balances layout density matching Jira boards with reactive, mobile-first design properties.

### 6.1 Desktop Viewport Strategy
*   **Kanban Dynamic Board Grid**: A responsive flex or table structure tracking the workflow channels. It supports drag-and-drop operations that trigger background `PATCH` API events.
*   **Contextual Drawer Component**: Selecting any board element expands a lateral inspector panel without breaking board spatial alignments. The panel exposes granular metadata controls (e.g., time logs, dependency toggles).
*   **Global Structural Filtering**: Persistent header configurations allow dynamic multi-select groupings by Assignee, Category, Tags, or an "AI Target Mode View" that mimics the `actionable` API filter.

### 6.2 Mobile Viewport Strategy ($< 768	ext{px}$)
*   **Normalized Linear Layout**: Column arrays break down into a single comprehensive active track.
*   **Segmented Control Pivot**: The UI exposes a sticky global tap-bar allowing users to shift active visibility focus across statuses (e.g., `Backlog (12)`, `To Do (3)`, `In Progress (1)`).
*   **Modal Interventions**: Contextual panels transition cleanly into overlay sheets anchored at the base of the device screen (`bottom sheet pattern`), using enlarged click boundaries ($44 	imes 44	ext{px}$) to avoid fat-finger input errors.

### 6.3 Settings / Admin Area
A dedicated route (e.g. `/settings/tokens`), visible only to `admin`-scoped sessions, provides full lifecycle management for API tokens without touching raw SQL or the Cloudflare dashboard:
*   **Token table**: name, scope badge, masked value (`token_prefix••••••••`), status (Active / Revoked / Expired), created date, last-used date.
*   **Issue Token**: modal form (name, scope, optional expiry). On submit, displays the plaintext token once in a copyable field with an explicit "copy it now — it won't be shown again" warning.
*   **Rotate**: per-row action behind a confirmation step; immediately invalidates the old token and displays the new plaintext once, same as issuance.
*   **Revoke**: per-row action behind a confirmation step; takes effect immediately, no grace period.
*   Follows the same mobile-first patterns as the rest of the app (§6.2) — the token table collapses to a card list, and issue/rotate/revoke flows use the bottom-sheet modal pattern on mobile.

---

## 7. System Integrity & AI Guardrails

Allowing programmatic mutation of database state by external automated agents presents severe transactional risks. The application execution layer enforces the following safety controls:

1.  **Circular Dependency Interception**: Any mutation updating `task_dependencies` initializes an in-memory or SQLite Common Table Expression (CTE) check. If the modification traces a self-referencing closed loop ($A 
ightarrow B 
ightarrow A$), the execution context halts and throws an explicit `422 Unprocessable Entity` status code to the agent.
2.  **Audit Trail Immutability**: Transaction timestamps (`created_at`, `updated_at`, `logged_at`) are computed exclusively by database trigger mechanics. Programmatic modifications attempting to fake historic or future log signatures are rejected.
3.  **Sanitization and Content Protection**: Markdown structures within descriptions are permitted, but raw HTML vectors are aggressively scrubbed by standard regex and parsing filters prior to record commitments to prevent prompt injection or XSS payloads from polluting client browsers.
4.  **Token Secrecy & Rate Limiting**: Plaintext API tokens are never persisted or logged; only their SHA-256 hash is stored (§5.1), and the plaintext is surfaced to the admin UI exactly once, at issuance or rotation. `agent`-scoped tokens are rate-limited at the Worker layer (default 60 requests/minute; §5.2), with `429` responses on excess to contain erratic automated loops.

---

## 8. Ambiguities & Recommended Enhancements for Review

During implementation planning, several critical edge cases and enhancements were identified that warrant consideration before finalizing development:

### 8.1 Multi-Agent Concurrency Control (Ambiguity)
*   **The Problem**: If an AI agent and a human user (or two distinct AI agents) read the database state simultaneously and make conflicting updates, the latter update will silently overwrite the first ("last write wins").
*   **Proposed Enhancement**: Add an incremental `version` integer column to the `tasks` table. Implement **Optimistic Concurrency Control (OCC)**. Every `PATCH` request must include the last seen `version`. If the version in the database is higher, the worker rejects the update with a `409 Conflict`, forcing the agent to fetch the updated entity state and re-evaluate its action.

### 8.2 Real-Time UI Sync & Execution Feedback Loop (Enhancement)
*   **The Problem**: When an AI agent modifies task attributes or moves a card across columns, a human viewing the desktop dashboard will not see changes until they refresh the browser page.
*   **Proposed Enhancement**: Integrate **Cloudflare Durable Objects** or **Server-Sent Events (SSE)** to provide a real-time reactive pipeline. When an agent logs hours or unblocks a dependency, the worker publishes a lightweight state transition packet, immediately shifting the card element on the human's screen.

### 8.3 Comprehensive Operations Audit Logging (Enhancement)
*   **The Problem**: If an autonomous agent erroneously deletes a task path or changes descriptions across dozens of cards, root-cause debugging becomes impossible without full point-in-time recovery logs.
*   **Proposed Enhancement**: Create a dedicated `audit_trail` table inside the SQLite engine tracking `actor_id` (human vs. agent identifier, per §5.2), `action_type` (`INSERT`, `UPDATE`, `DELETE`), `task_id`, `field_changed`, `old_value`, and `new_value`. This ensures full observability and provides a mechanism to revert rogue AI behaviors safely.

### 8.4 Human Sign-In Mechanism (Ambiguity)
*   **The Problem**: §5 specifies how bearer tokens are validated and how admins manage them, but not how a human obtains their *first* `admin`-scoped token — bootstrapping the initial admin account is still unspecified.
*   **Proposed Enhancement**: Options include (a) a one-time setup token minted as a Cloudflare Workers secret at deploy time, exchanged for the first `admin` token on first run; (b) Cloudflare Access in front of the Pages UI only, with an authenticated Access identity triggering a token exchange; (c) a minimal password-based login screen backed by a `users` table. Given the project's lightweight scope, this should be decided based on how many humans will actually use the tool, not built defensively for scale that doesn't exist yet.

---

## 9. MCP Server (Decided Enhancement)

A remote **Model Context Protocol** server exposes the board to any MCP-capable client (Claude Desktop, Cursor, custom agents), complementing the raw REST API and the `task-manager-api` skill. It is deliberately a **transport shim, not a second API**: it owns no task logic. This was added as a scoped enhancement beyond §8's four; further MCP-specific features should still follow §8's "ask before assuming in scope" rule.

*   **Endpoint**: `POST /api/mcp` — Streamable HTTP transport, stateless (each JSON-RPC request is answered with a single `application/json` response; no SSE session). `GET` returns `405`. Handles `initialize`, `tools/list`, and `tools/call`.
*   **Auth (§5)**: the same bearer token model. The endpoint rejects any request without a valid token (`401`); each `tools/call` re-enters the Worker's own routes carrying that token, so per-route scope enforcement, rate limiting, and every §7 guardrail (OCC/`409`, cycle detection/`422`, sanitization, audit, realtime) apply exactly once, unchanged. No new credential path is introduced.
*   **Tools**: a 1:1 mapping onto existing endpoints — reads (`list_tasks`, `get_task`, `agenda`, `actionable`, `blocked`) and writes (`create_task`, `update_task`, `delete_task`, `log_time`).
*   **Admin control (§6.3)**: configuration is surfaced in the Settings area (Settings → MCP) and persisted in a `settings` key/value table. `enabled` is a master on/off switch (**off by default** — a newly added remote interface is not exposed until an admin turns it on); `write_enabled` optionally restricts the server to read-only tools. Both are admin-only (`GET`/`PATCH /api/admin/mcp`).
