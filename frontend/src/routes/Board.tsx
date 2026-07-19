import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useTasks } from '../hooks/useTasks';
import type { TaskEntity, TaskStatus } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { FilterBar } from '../components/FilterBar';
import { KanbanBoard } from '../components/KanbanBoard';
import { MobileBoard } from '../components/MobileBoard';
import { TaskDrawer } from '../components/TaskDrawer';
import { NewTaskModal } from '../components/NewTaskModal';

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}

export function Board() {
  const { session } = useAuth();
  const token = session!.token;
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [assignee, setAssignee] = useState('');
  const [category, setCategory] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [aiMode, setAiMode] = useState(false);
  const [activeStatus, setActiveStatus] = useState<TaskStatus>('todo');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [actionableIds, setActionableIds] = useState<Set<string> | null>(null);

  const { tasks, loading, error, upsertLocal, removeLocal } = useTasks(token, { assignee, category });

  useEffect(() => {
    if (!aiMode) {
      setActionableIds(null);
      return;
    }
    let cancelled = false;
    api.agentActionable(token).then(({ tasks: actionable }) => {
      if (!cancelled) setActionableIds(new Set(actionable.map((t) => t.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [aiMode, token, tasks]);

  const filteredByTags = useMemo(
    () => (selectedTags.length ? tasks.filter((t) => selectedTags.every((tag) => t.tags.includes(tag))) : tasks),
    [tasks, selectedTags]
  );

  const visibleTasks = aiMode && actionableIds ? filteredByTags.filter((t) => actionableIds.has(t.id)) : filteredByTags;

  const assignees = useMemo(() => uniqueSorted(tasks.map((t) => t.assignee)), [tasks]);
  const categories = useMemo(() => uniqueSorted(tasks.map((t) => t.category)), [tasks]);
  const allTags = useMemo(() => uniqueSorted(tasks.flatMap((t) => t.tags)), [tasks]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  async function handleMove(task: TaskEntity, status: TaskStatus) {
    try {
      const updated = await api.patchTask(token, task.id, { version: task.version, status });
      upsertLocal(updated);
    } catch {
      // Board will resync on next reload/SSE event; avoid a blocking alert for a drag-and-drop miss.
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <div className="app-shell">
      <TopBar onNewTask={() => setShowNewTask(true)} />
      <FilterBar
        assignees={assignees}
        categories={categories}
        tags={allTags}
        assignee={assignee}
        category={category}
        selectedTags={selectedTags}
        aiMode={aiMode}
        onAssigneeChange={setAssignee}
        onCategoryChange={setCategory}
        onToggleTag={toggleTag}
        onToggleAiMode={() => setAiMode((v) => !v)}
      />

      <div className="board-scroll">
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : error ? (
          <p className="empty-state">{error}</p>
        ) : isMobile ? (
          <MobileBoard tasks={visibleTasks} activeStatus={activeStatus} onChangeStatus={setActiveStatus} onOpen={setSelectedTaskId} />
        ) : (
          <KanbanBoard tasks={visibleTasks} onOpen={setSelectedTaskId} onMove={handleMove} />
        )}
      </div>

      <button type="button" className="fab" onClick={() => setShowNewTask(true)} aria-label="New task">
        +
      </button>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          allTasks={tasks}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={upsertLocal}
          onDeleted={(id) => {
            removeLocal(id);
            setSelectedTaskId(null);
          }}
        />
      )}

      {showNewTask && <NewTaskModal onClose={() => setShowNewTask(false)} onCreated={upsertLocal} />}
    </div>
  );
}
