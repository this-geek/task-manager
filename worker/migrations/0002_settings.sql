-- Application settings (key/value, JSON-encoded values).
-- Currently backs the admin-controlled MCP server config (enabled / write access).
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL, -- JSON-encoded blob for the key
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_by TEXT -- api_tokens.id of the admin who last changed it
);
