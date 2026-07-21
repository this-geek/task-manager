export interface McpConfig {
  enabled: boolean;
  write_enabled: boolean;
}

const MCP_KEY = 'mcp';

// A newly added remote interface stays off until an admin deliberately enables it
// from Settings → MCP; write access defaults on so enabling gives a fully working server.
const DEFAULT_MCP_CONFIG: McpConfig = { enabled: false, write_enabled: true };

export async function getMcpConfig(db: D1Database): Promise<McpConfig> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(MCP_KEY).first<{ value: string }>();
  if (!row) return { ...DEFAULT_MCP_CONFIG };
  try {
    const parsed = JSON.parse(row.value) as Partial<McpConfig>;
    return { ...DEFAULT_MCP_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_MCP_CONFIG };
  }
}

export async function setMcpConfig(db: D1Database, patch: Partial<McpConfig>, actorId: string): Promise<McpConfig> {
  const next = { ...(await getMcpConfig(db)), ...patch };
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_by) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .bind(MCP_KEY, JSON.stringify(next), actorId)
    .run();
  return next;
}
