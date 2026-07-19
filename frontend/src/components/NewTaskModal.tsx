import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { TaskEntity } from '../lib/types';

interface Props {
  onClose: () => void;
  onCreated: (task: TaskEntity) => void;
}

export function NewTaskModal({ onClose, onCreated }: Props) {
  const { session } = useAuth();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimatedTime, setEstimatedTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask(session!.token, {
        title: title.trim(),
        category: category.trim() || 'General',
        assignee: assignee.trim() || undefined,
        due_date: dueDate || undefined,
        estimated_time: estimatedTime ? Number(estimatedTime) : undefined,
      });
      onCreated(task);
      onClose();
    } catch {
      setError('Could not create the task.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>New task</h2>
        <form onSubmit={handleSubmit}>
          <label htmlFor="new-title">Title</label>
          <input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />

          <div className="field-row">
            <div>
              <label htmlFor="new-category">Category</label>
              <input id="new-category" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <label htmlFor="new-assignee">Assignee</label>
              <input id="new-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <div>
              <label htmlFor="new-due">Due date</label>
              <input id="new-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="new-estimate">Estimate (minutes)</label>
              <input
                id="new-estimate"
                type="number"
                min={0}
                value={estimatedTime}
                onChange={(e) => setEstimatedTime(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !title.trim()}>
              {busy ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
