import { useCallback, useEffect, useState } from 'react';
import { api, type TaskFilters } from '../lib/api';
import type { TaskEntity } from '../lib/types';
import { useTaskEvents } from './useTaskEvents';

export function useTasks(token: string | null, filters: TaskFilters) {
  const [tasks, setTasks] = useState<TaskEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const { tasks: loaded } = await api.listTasks(token, filters);
      setTasks(loaded);
    } catch {
      setError('Could not load tasks.');
    } finally {
      setLoading(false);
    }
    // filters is a plain object rebuilt each render by the caller; stringify to avoid refetch loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, JSON.stringify(filters)]);

  useEffect(() => {
    reload();
  }, [reload]);

  const upsertLocal = useCallback((task: TaskEntity) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx === -1) return [task, ...prev];
      const next = [...prev];
      next[idx] = task;
      return next;
    });
  }, []);

  const removeLocal = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useTaskEvents(
    token,
    useCallback(
      (payload) => {
        if (payload.type === 'task.deleted') {
          removeLocal(payload.task.id);
        } else {
          upsertLocal(payload.task as TaskEntity);
        }
      },
      [removeLocal, upsertLocal]
    )
  );

  return { tasks, loading, error, reload, upsertLocal, removeLocal };
}
