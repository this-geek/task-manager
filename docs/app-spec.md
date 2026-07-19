# Technical Specification: AI-Optimized Task Management System (Jira-Style)

## 1. System Architecture Overview

This specification details a lightweight, ultra-low latency, serverless task management system. The platform provides a responsive, Jira-style visual interface for human users while serving optimized JSON payloads tailored for autonomous AI agents.

### Core Stack
*   **Frontend**: Single Page Application (SPA) or Server-Side Rendered (SSR) framework (e.g., Remix, Next.js, or solid vanilla JS) hosted on **Cloudflare Pages**.
*   **Backend**: **Cloudflare Workers** providing stateless API routing, schema validation, and specialized context formatting for Large Language Models (LLMs).
*   **Database**: **Cloudflare D1**, a distributed native SQLite database engine running at the edge.

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

-- Indexing for Query Optimization
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX idx_task_dependencies_blocked ON task_dependencies(blocked_by_task_id);
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

## 5. UI/UX Functional Interface Requirements

The user interface balances layout density matching Jira boards with reactive, mobile-first design properties.

### 5.1 Desktop Viewport Strategy
*   **Kanban Dynamic Board Grid**: A responsive flex or table structure tracking the workflow channels. It supports drag-and-drop operations that trigger background `PATCH` API events.
*   **Contextual Drawer Component**: Selecting any board element expands a lateral inspector panel without breaking board spatial alignments. The panel exposes granular metadata controls (e.g., time logs, dependency toggles).
*   **Global Structural Filtering**: Persistent header configurations allow dynamic multi-select groupings by Assignee, Category, Tags, or an "AI Target Mode View" that mimics the `actionable` API filter.

### 5.2 Mobile Viewport Strategy ($< 768	ext{px}$)
*   **Normalized Linear Layout**: Column arrays break down into a single comprehensive active track.
*   **Segmented Control Pivot**: The UI exposes a sticky global tap-bar allowing users to shift active visibility focus across statuses (e.g., `Backlog (12)`, `To Do (3)`, `In Progress (1)`).
*   **Modal Interventions**: Contextual panels transition cleanly into overlay sheets anchored at the base of the device screen (`bottom sheet pattern`), using enlarged click boundaries ($44 	imes 44	ext{px}$) to avoid fat-finger input errors.

---

## 6. System Integrity & AI Guardrails

Allowing programmatic mutation of database state by external automated agents presents severe transactional risks. The application execution layer enforces the following safety controls:

1.  **Circular Dependency Interception**: Any mutation updating `task_dependencies` initializes an in-memory or SQLite Common Table Expression (CTE) check. If the modification traces a self-referencing closed loop ($A 
ightarrow B 
ightarrow A$), the execution context halts and throws an explicit `422 Unprocessable Entity` status code to the agent.
2.  **Audit Trail Immutability**: Transaction timestamps (`created_at`, `updated_at`, `logged_at`) are computed exclusively by database trigger mechanics. Programmatic modifications attempting to fake historic or future log signatures are rejected.
3.  **Sanitization and Content Protection**: Markdown structures within descriptions are permitted, but raw HTML vectors are aggressively scrubbed by standard regex and parsing filters prior to record commitments to prevent prompt injection or XSS payloads from polluting client browsers.

---

## 7. Ambiguities & Recommended Enhancements for Review

During implementation planning, several critical edge cases and enhancements were identified that warrant consideration before finalizing development:

### 7.1 Multi-Agent Concurrency Control (Ambiguity)
*   **The Problem**: If an AI agent and a human user (or two distinct AI agents) read the database state simultaneously and make conflicting updates, the latter update will silently overwrite the first ("last write wins").
*   **Proposed Enhancement**: Add an incremental `version` integer column to the `tasks` table. Implement **Optimistic Concurrency Control (OCC)**. Every `PATCH` request must include the last seen `version`. If the version in the database is higher, the worker rejects the update with a `409 Conflict`, forcing the agent to fetch the updated entity state and re-evaluate its action.

### 7.2 AI Authentication, Authorization, and Scoping (Ambiguity)
*   **The Problem**: The initial specification does not separate human user credentials from AI service accounts, leaving the system vulnerable if an automated loop behaves erratically.
*   **Proposed Enhancement**: Implement a dual-token access model using Cloudflare Workers Secret variables or D1 token verification. AI agents should use dedicated API keys with strict **Rate Limiting** (e.g., maximum 60 requests per minute) and bounded database scopes, separating them from human bearer tokens to protect resource consumption.

### 7.3 Real-Time UI Sync & Execution Feedback Loop (Enhancement)
*   **The Problem**: When an AI agent modifies task attributes or moves a card across columns, a human viewing the desktop dashboard will not see changes until they refresh the browser page.
*   **Proposed Enhancement**: Integrate **Cloudflare Durable Objects** or **Server-Sent Events (SSE)** to provide a real-time reactive pipeline. When an agent logs hours or unblocks a dependency, the worker publishes a lightweight state transition packet, immediately shifting the card element on the human's screen.

### 7.4 Comprehensive Operations Audit Logging (Enhancement)
*   **The Problem**: If an autonomous agent erroneously deletes a task path or changes descriptions across dozens of cards, root-cause debugging becomes impossible without full point-in-time recovery logs.
*   **Proposed Enhancement**: Create a dedicated `audit_trail` table inside the SQLite engine tracking `actor_id` (human vs. agent identifier), `action_type` (`INSERT`, `UPDATE`, `DELETE`), `task_id`, `field_changed`, `old_value`, and `new_value`. This ensures full observability and provides a mechanism to revert rogue AI behaviors safely.
