import type { JSX } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { SignIn } from './routes/SignIn';
import { Board } from './routes/Board';
import { SettingsTokens } from './routes/SettingsTokens';
import { SettingsMcp } from './routes/SettingsMcp';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/sign-in" replace />;
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/sign-in" replace />;
  if (!session.isAdmin) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Board />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/tokens"
        element={
          <RequireAdmin>
            <SettingsTokens />
          </RequireAdmin>
        }
      />
      <Route
        path="/settings/mcp"
        element={
          <RequireAdmin>
            <SettingsMcp />
          </RequireAdmin>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
