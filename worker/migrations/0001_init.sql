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
    version INT NOT NULL DEFAULT 1, -- Optimistic concurrency control (spec §8.1)
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

-- Audit Trail (spec §8.3) — one row per field changed by a mutation
CREATE TABLE audit_trail (
    id TEXT PRIMARY KEY, -- UUIDv4
    actor_id TEXT, -- api_tokens.id of the caller, NULL for system actions
    actor_scope TEXT, -- scope of the acting token at the time of the action
    action_type TEXT NOT NULL CHECK(action_type IN ('INSERT', 'UPDATE', 'DELETE')),
    task_id TEXT NOT NULL,
    field_changed TEXT, -- NULL for whole-row INSERT/DELETE
    old_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Indexing for Query Optimization
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX idx_task_dependencies_blocked ON task_dependencies(blocked_by_task_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX idx_audit_trail_task ON audit_trail(task_id);
