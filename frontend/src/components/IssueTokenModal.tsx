import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { TokenScope } from '../lib/types';

interface Props {
  onClose: () => void;
  onIssued: () => void;
}

export function IssueTokenModal({ onClose, onIssued }: Props) {
  const { session } = useAuth();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('agent');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.issueToken(session!.token, {
        name: name.trim(),
        scope,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setPlaintext(result.token);
      onIssued();
    } catch {
      setError('Could not issue the token.');
    } finally {
      setBusy(false);
    }
  }

  if (plaintext) {
    return (
      <div className="modal-backdrop">
        <div className="modal-card">
          <h2>Token issued</h2>
          <p className="hint">Copy it now — it won't be shown again.</p>
          <p className="token-plaintext">{plaintext}</p>
          <div className="modal-actions">
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Issue token</h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="tok-name">Name</label>
          <input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude Agent - Prod" autoFocus required />

          <label htmlFor="tok-scope">Scope</label>
          <select id="tok-scope" value={scope} onChange={(e) => setScope(e.target.value as TokenScope)}>
            <option value="agent">agent</option>
            <option value="human">human</option>
            <option value="admin">admin</option>
          </select>

          <label htmlFor="tok-expiry">Expiry (optional)</label>
          <input id="tok-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>
              {busy ? 'Issuing…' : 'Issue token'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
