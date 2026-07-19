import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export interface Session {
  token: string;
  isAdmin: boolean;
}

const STORAGE_KEY = 'task-manager.session';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

interface AuthContextValue {
  session: Session | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const signIn = useCallback(async (token: string) => {
    // Validate the token against a real endpoint, then probe admin scope by
    // trying an admin-only route — there's no dedicated "whoami" endpoint in
    // the spec, so this reuses the existing surface instead of adding one.
    await api.listTasks(token);

    let isAdmin = false;
    try {
      await api.listTokens(token);
      isAdmin = true;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 403) throw err;
    }

    const next: Session = { token, isAdmin };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
