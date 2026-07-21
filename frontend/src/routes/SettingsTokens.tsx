import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ApiToken } from '../lib/types';
import { TOKEN_STATUS_LABELS, tokenStatus } from '../lib/tokenStatus';
import { IssueTokenModal } from '../components/IssueTokenModal';

export function SettingsTokens() {
  const { session } = useAuth();
  const token = session!.token;

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIssue, setShowIssue] = useState(false);
  const [rotatedPlaintext, setRotatedPlaintext] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const { tokens: loaded } = await api.listTokens(token);
    setTokens(loaded);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRotate(row: ApiToken) {
    if (!confirm(`Rotate "${row.name}"? The old token stops working immediately.`)) return;
    const result = await api.rotateToken(token, row.id);
    setRotatedPlaintext(result.token);
    await reload();
  }

  async function handleRevoke(row: ApiToken) {
    if (!confirm(`Revoke "${row.name}"? This takes effect immediately.`)) return;
    await api.revokeToken(token, row.id);
    await reload();
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <Link to="/">← Board</Link>
        <h1>Settings · Tokens</h1>
        <nav>
          <Link to="/settings/mcp">MCP</Link>
        </nav>
      </header>

      <div className="tokens-page">
        <div className="tokens-page-header">
          <h2>API Tokens</h2>
          <button type="button" className="primary" onClick={() => setShowIssue(true)}>
            + Issue token
          </button>
        </div>

        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="empty-state">No tokens yet.</p>
        ) : (
          <>
            <table className="tokens-table tokens-table-desktop">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((row) => {
                  const status = tokenStatus(row);
                  return (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>
                        <span className={`badge scope-${row.scope}`}>{row.scope}</span>
                      </td>
                      <td>
                        <code>{row.token_prefix}••••••••</code>
                      </td>
                      <td>
                        <span className={`badge status-${status}`}>{TOKEN_STATUS_LABELS[status]}</span>
                      </td>
                      <td>{row.created_at.slice(0, 10)}</td>
                      <td>{row.last_used_at ? row.last_used_at.slice(0, 10) : '—'}</td>
                      <td>
                        {status !== 'revoked' && (
                          <>
                            <button type="button" className="ghost" onClick={() => handleRotate(row)}>
                              Rotate
                            </button>
                            <button type="button" className="ghost" onClick={() => handleRevoke(row)}>
                              Revoke
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="token-cards">
              {tokens.map((row) => {
                const status = tokenStatus(row);
                return (
                  <div key={row.id} className="token-card">
                    <div className="row">
                      <strong>{row.name}</strong>
                      <span className={`badge scope-${row.scope}`}>{row.scope}</span>
                    </div>
                    <div className="row">
                      <code>{row.token_prefix}••••••••</code>
                      <span className={`badge status-${status}`}>{TOKEN_STATUS_LABELS[status]}</span>
                    </div>
                    <div className="row hint">
                      <span>Created {row.created_at.slice(0, 10)}</span>
                      <span>{row.last_used_at ? `Used ${row.last_used_at.slice(0, 10)}` : 'Never used'}</span>
                    </div>
                    {status !== 'revoked' && (
                      <div className="row">
                        <button type="button" className="ghost" onClick={() => handleRotate(row)}>
                          Rotate
                        </button>
                        <button type="button" className="ghost" onClick={() => handleRevoke(row)}>
                          Revoke
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showIssue && (
        <IssueTokenModal
          onClose={() => {
            setShowIssue(false);
            reload();
          }}
          onIssued={reload}
        />
      )}

      {rotatedPlaintext && (
        <div className="modal-backdrop" onClick={() => setRotatedPlaintext(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Token rotated</h2>
            <p className="hint">Copy it now — it won't be shown again.</p>
            <p className="token-plaintext">{rotatedPlaintext}</p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={() => setRotatedPlaintext(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
