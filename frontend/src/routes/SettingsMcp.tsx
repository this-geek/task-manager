import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { McpConfig } from '../lib/types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

function mcpEndpoint(): string {
  const origin = BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${origin}/api/mcp`;
}

export function SettingsMcp() {
  const { session } = useAuth();
  const token = session!.token;

  const [config, setConfig] = useState<McpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMcpConfig(token)
      .then(({ mcp }) => setConfig(mcp))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  async function patch(next: Partial<McpConfig>) {
    if (!config) return;
    const previous = config;
    setConfig({ ...config, ...next });
    setSaving(true);
    setError(null);
    try {
      const { mcp } = await api.updateMcpConfig(token, next);
      setConfig(mcp);
    } catch (err) {
      setConfig(previous);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const endpoint = mcpEndpoint();

  return (
    <div className="app-shell">
      <header className="top-bar">
        <Link to="/">← Board</Link>
        <h1>Settings · MCP</h1>
        <nav>
          <Link to="/settings/tokens">Tokens</Link>
        </nav>
      </header>

      <div className="tokens-page">
        <div className="tokens-page-header">
          <h2>MCP Server</h2>
          {config && (
            <span className={`badge ${config.enabled ? 'status-active' : 'status-revoked'}`}>
              {config.enabled ? 'Enabled' : 'Disabled'}
            </span>
          )}
        </div>

        <p className="hint">
          Exposes the board to any Model Context Protocol client (Claude Desktop, Cursor, custom agents) as typed tools
          over the same authenticated API. Clients connect with an <code>agent</code>-scoped token.
        </p>

        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : !config ? (
          <p className="empty-state">{error ?? 'Failed to load configuration.'}</p>
        ) : (
          <>
            <div className="settings-panel">
              <label className="switch-row">
                <span>
                  <strong>Enable MCP server</strong>
                  <span className="hint">Off by default. When off, <code>/api/mcp</code> refuses all connections.</span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={config.enabled}
                  disabled={saving}
                  onChange={(e) => patch({ enabled: e.target.checked })}
                />
              </label>

              <label className="switch-row">
                <span>
                  <strong>Allow write operations</strong>
                  <span className="hint">
                    When off, only read tools (agenda, actionable, blocked, list, get) are exposed — agents can't create,
                    update, or delete tasks.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={config.write_enabled}
                  disabled={saving || !config.enabled}
                  onChange={(e) => patch({ write_enabled: e.target.checked })}
                />
              </label>
            </div>

            {error && <p className="error" role="alert">{error}</p>}

            <div className="settings-panel">
              <h3>Connecting a client</h3>
              <p className="hint">Point an MCP client at this endpoint and authenticate with a bearer token:</p>
              <p className="token-plaintext">{endpoint}</p>
              <p className="hint">
                Issue an <code>agent</code>-scoped token on the{' '}
                <Link to="/settings/tokens">Tokens</Link> page, then add it as the{' '}
                <code>Authorization: Bearer &lt;token&gt;</code> header in the client's server config.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
