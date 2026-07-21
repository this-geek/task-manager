import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

interface Props {
  onNewTask?: () => void;
}

export function TopBar({ onNewTask }: Props) {
  const { session, signOut } = useAuth();

  return (
    <header className="top-bar">
      <h1>Task Manager</h1>
      <nav>
        {onNewTask && (
          <button type="button" className="primary new-task-btn" onClick={onNewTask}>
            + New task
          </button>
        )}
        {session?.isAdmin && <Link to="/settings/tokens">Settings · Tokens</Link>}
        {session?.isAdmin && <Link to="/settings/mcp">Settings · MCP</Link>}
        <button type="button" className="ghost" onClick={signOut}>
          Sign out
        </button>
      </nav>
    </header>
  );
}
