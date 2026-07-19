import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { STATUSES, STATUS_LABELS, type TaskDetailEntity, type TaskEntity, type TaskStatus } from '../lib/types';
import { formatMinutes } from '../lib/dates';

interface Props {
  task: TaskEntity;
  allTasks: TaskEntity[];
  onClose: () => void;
  onUpdated: (task: TaskEntity) => void;
  onDeleted: (id: string) => void;
}

export function TaskDrawer({ task, allTasks, onClose, onUpdated, onDeleted }: Props) {
  const { session } = useAuth();
  const token = session!.token;
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [detail, setDetail] = useState<TaskDetailEntity>({ ...task, time_logs: [] });
  const [notice, setNotice] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [newLink, setNewLink] = useState({ url: '', label: '' });
  const [newLog, setNewLog] = useState({ duration: '', notes: '' });
  const [depToAdd, setDepToAdd] = useState('');

  useEffect(() => {
    setDetail({ ...task, time_logs: [] });
    api
      .getTask(token, task.id)
      .then(setDetail)
      .catch(() => {
        /* keep the list-level snapshot if the detail fetch fails */
      });
  }, [task.id, token]);

  async function patch(body: Record<string, unknown>) {
    try {
      const updated = await api.patchTask(token, detail.id, { version: detail.version, ...body });
      setDetail((prev) => ({ ...updated, time_logs: prev.time_logs }));
      onUpdated(updated);
      setNotice(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const fresh = await api.getTask(token, detail.id);
        setDetail(fresh);
        onUpdated(fresh);
        setNotice('This task changed elsewhere — refreshed to the latest version.');
      } else if (err instanceof ApiError && err.status === 422) {
        setNotice(err.message);
      } else {
        setNotice('Update failed. Please try again.');
      }
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${detail.title}"? This cannot be undone.`)) return;
    await api.deleteTask(token, detail.id);
    onDeleted(detail.id);
    onClose();
  }

  async function addTag() {
    const tag = newTag.trim();
    if (!tag || detail.tags.includes(tag)) return;
    setNewTag('');
    await patch({ tags: [...detail.tags, tag] });
  }

  async function removeTag(tag: string) {
    await patch({ tags: detail.tags.filter((t) => t !== tag) });
  }

  async function addLink() {
    if (!newLink.url.trim() || !newLink.label.trim()) return;
    const link = { url: newLink.url.trim(), label: newLink.label.trim() };
    setNewLink({ url: '', label: '' });
    await patch({ links: [...detail.links, link] });
  }

  async function removeLink(url: string) {
    await patch({ links: detail.links.filter((l) => l.url !== url) });
  }

  async function addDependency() {
    if (!depToAdd || detail.dependencies.includes(depToAdd)) return;
    const id = depToAdd;
    setDepToAdd('');
    await patch({ dependencies: [...detail.dependencies, id] });
  }

  async function removeDependency(id: string) {
    await patch({ dependencies: detail.dependencies.filter((d) => d !== id) });
  }

  async function submitTimeLog() {
    const duration = Number(newLog.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      const updated = await api.logTime(token, detail.id, { duration, notes: newLog.notes.trim() || undefined });
      setDetail(updated);
      onUpdated(updated);
      setNewLog({ duration: '', notes: '' });
    } catch {
      setNotice('Could not log time.');
    }
  }

  const dependencyCandidates = allTasks.filter((t) => t.id !== detail.id && !detail.dependencies.includes(t.id));
  const depTitle = (id: string) => allTasks.find((t) => t.id === id)?.title ?? id;

  const body = (
    <>
      <div className="drawer-header">
        <span className={`dot status-dot-${detail.status}`} style={{ width: 10, height: 10, borderRadius: '50%' }} />
        <h2 style={{ fontSize: '1rem' }}>{detail.title}</h2>
        <button type="button" className="ghost close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        {notice && (
          <p className="hint drawer-notice" role="status">
            {notice}
          </p>
        )}

        <section>
          <h3>Details</h3>
          <label htmlFor="d-title">Title</label>
          <input
            key={`title-${detail.version}`}
            id="d-title"
            defaultValue={detail.title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== detail.title && patch({ title: e.target.value.trim() })}
          />

          <label htmlFor="d-desc">Description</label>
          <textarea
            key={`desc-${detail.version}`}
            id="d-desc"
            defaultValue={detail.description ?? ''}
            onBlur={(e) => e.target.value !== (detail.description ?? '') && patch({ description: e.target.value })}
          />

          <div className="field-row">
            <div>
              <label htmlFor="d-status">Status</label>
              <select id="d-status" value={detail.status} onChange={(e) => patch({ status: e.target.value as TaskStatus })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="d-due">Due date</label>
              <input
                id="d-due"
                type="date"
                value={detail.due_date ?? ''}
                onChange={(e) => patch({ due_date: e.target.value || null })}
              />
            </div>
          </div>

          <div className="field-row">
            <div>
              <label htmlFor="d-category">Category</label>
              <input
                key={`category-${detail.version}`}
                id="d-category"
                defaultValue={detail.category}
                onBlur={(e) => e.target.value.trim() && e.target.value !== detail.category && patch({ category: e.target.value.trim() })}
              />
            </div>
            <div>
              <label htmlFor="d-assignee">Assignee</label>
              <input
                key={`assignee-${detail.version}`}
                id="d-assignee"
                defaultValue={detail.assignee ?? ''}
                onBlur={(e) => e.target.value !== (detail.assignee ?? '') && patch({ assignee: e.target.value || null })}
              />
            </div>
          </div>

          <label htmlFor="d-estimate">Estimated time (minutes)</label>
          <input
            key={`estimate-${detail.version}`}
            id="d-estimate"
            type="number"
            min={0}
            defaultValue={detail.estimated_time}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0 && n !== detail.estimated_time) patch({ estimated_time: n });
            }}
          />
          <p className="hint">Actual time logged: {formatMinutes(detail.actual_time)}</p>
        </section>

        <section>
          <h3>Tags</h3>
          <div className="chip-list">
            {detail.tags.map((tag) => (
              <span key={tag} className="chip">
                #{tag}
                <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="field-row" style={{ marginTop: '0.5rem' }}>
            <input placeholder="Add tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} />
            <button type="button" onClick={addTag}>
              Add
            </button>
          </div>
        </section>

        <section>
          <h3>Links</h3>
          {detail.links.map((link) => (
            <div key={link.url} className="link-item">
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
              <button type="button" className="ghost" onClick={() => removeLink(link.url)} aria-label={`Remove link ${link.label}`}>
                ✕
              </button>
            </div>
          ))}
          <div className="field-row" style={{ marginTop: '0.5rem' }}>
            <input placeholder="Label" value={newLink.label} onChange={(e) => setNewLink((l) => ({ ...l, label: e.target.value }))} />
            <input placeholder="https://…" value={newLink.url} onChange={(e) => setNewLink((l) => ({ ...l, url: e.target.value }))} />
            <button type="button" onClick={addLink}>
              Add
            </button>
          </div>
        </section>

        <section>
          <h3>Dependencies (blocked by)</h3>
          {detail.dependencies.map((id) => (
            <div key={id} className="dependency-item">
              <span>{depTitle(id)}</span>
              <button type="button" className="ghost" onClick={() => removeDependency(id)} aria-label="Remove dependency">
                ✕
              </button>
            </div>
          ))}
          {detail.dependencies.length === 0 && <p className="hint">Not blocked by anything.</p>}
          <div className="field-row" style={{ marginTop: '0.5rem' }}>
            <select value={depToAdd} onChange={(e) => setDepToAdd(e.target.value)}>
              <option value="">Select a task…</option>
              {dependencyCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button type="button" onClick={addDependency} disabled={!depToAdd}>
              Add
            </button>
          </div>
        </section>

        <section>
          <h3>Time logs</h3>
          {detail.time_logs.map((log) => (
            <div key={log.id} className="time-log-item">
              <span>{formatMinutes(log.duration)}</span>
              <span className="hint" style={{ flex: 1 }}>
                {log.notes}
              </span>
              <span className="hint">{log.logged_at.slice(0, 10)}</span>
            </div>
          ))}
          <div className="field-row" style={{ marginTop: '0.5rem' }}>
            <input
              type="number"
              placeholder="Minutes"
              min={1}
              value={newLog.duration}
              onChange={(e) => setNewLog((l) => ({ ...l, duration: e.target.value }))}
            />
            <input placeholder="Notes (optional)" value={newLog.notes} onChange={(e) => setNewLog((l) => ({ ...l, notes: e.target.value }))} />
            <button type="button" onClick={submitTimeLog}>
              Log
            </button>
          </div>
        </section>

        <button type="button" className="danger" onClick={handleDelete}>
          Delete task
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className={isMobile ? 'sheet-panel' : 'drawer-panel'}>
        {isMobile && <div className="sheet-handle" />}
        {body}
      </div>
    </>
  );
}
