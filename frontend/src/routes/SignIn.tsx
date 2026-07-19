import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

type Mode = 'signin' | 'setup';

export function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [tokenInput, setTokenInput] = useState('');
  const [setupName, setSetupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(tokenInput.trim());
      navigate('/', { replace: true });
    } catch {
      setError('That token was rejected. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.setup(tokenInput.trim(), setupName.trim() || undefined);
      await signIn(result.token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Setup has already run once. Ask your admin for a token instead.'
          : 'Setup failed. Check the setup secret and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Task Manager</h1>
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(null); }}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'setup'} className={mode === 'setup' ? 'active' : ''} onClick={() => { setMode('setup'); setError(null); }}>
            First-time setup
          </button>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn}>
            <label htmlFor="token">API token</label>
            <input
              id="token"
              type="password"
              autoComplete="off"
              placeholder="tm_live_…"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              required
            />
            <p className="hint">Paste the bearer token an admin issued you.</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy || !tokenInput.trim()}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSetup}>
            <label htmlFor="setup-token">Setup secret</label>
            <input
              id="setup-token"
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              required
            />
            <label htmlFor="admin-name">Your name (optional)</label>
            <input id="admin-name" type="text" value={setupName} onChange={(e) => setSetupName(e.target.value)} />
            <p className="hint">
              Works once. Uses the <code>SETUP_TOKEN</code> secret configured on the Worker to mint the first admin
              token.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy || !tokenInput.trim()}>
              {busy ? 'Setting up…' : 'Create admin token'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
