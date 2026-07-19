import { Hono } from 'hono';
import type { Actor, Env, TaskRow } from '../types';
import { requireAuth } from '../lib/auth';

export const agentRoute = new Hono<{ Bindings: Env; Variables: { actor: Actor } }>();

agentRoute.use('*', requireAuth('admin', 'human', 'agent'));

/** Lean, token-minimal task summary — spec §4.2 intro: strip presentation layers, don't balloon into full entity dumps. */
interface AgentTaskSummary {
  id: string;
  title: string;
  status: TaskRow['status'];
  due_date: string | null;
  category: string;
  assignee: string | null;
  estimated_time: number;
}

function toSummary(row: TaskRow): AgentTaskSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    due_date: row.due_date,
    category: row.category,
    assignee: row.assignee,
    estimated_time: row.estimated_time,
  };
}

agentRoute.get('/agenda', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM tasks
     WHERE due_date IS NOT NULL AND due_date <= date('now') AND status != 'done'
     ORDER BY due_date ASC`
  ).all<TaskRow>();

  return c.json({ tasks: results.map(toSummary) });
});

agentRoute.get('/actionable', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM tasks
     WHERE status IN ('todo', 'in_progress')
     AND id NOT IN (
       SELECT task_dependencies.task_id FROM task_dependencies
       JOIN tasks ON task_dependencies.blocked_by_task_id = tasks.id
       WHERE tasks.status != 'done'
     )
     ORDER BY due_date IS NULL, due_date ASC`
  ).all<TaskRow>();

  return c.json({ tasks: results.map(toSummary) });
});

interface RootBlocker {
  id: string;
  title: string;
  status: TaskRow['status'];
}

async function findRootBlockers(db: D1Database, taskId: string): Promise<RootBlocker[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE chain(id) AS (
         SELECT blocked_by_task_id AS id FROM task_dependencies WHERE task_id = ?1
         UNION
         SELECT td.blocked_by_task_id FROM task_dependencies td JOIN chain c ON td.task_id = c.id
       )
       SELECT t.id, t.title, t.status FROM tasks t
       WHERE t.id IN (SELECT id FROM chain) AND t.status != 'done'
       AND NOT EXISTS (
         SELECT 1 FROM task_dependencies td2
         JOIN tasks t2 ON t2.id = td2.blocked_by_task_id
         WHERE td2.task_id = t.id AND t2.status != 'done'
       )`
    )
    .bind(taskId)
    .all<RootBlocker>();

  return results;
}

agentRoute.get('/blocked', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT t.* FROM tasks t
     WHERE t.status = 'blocked'
        OR (t.status != 'done' AND EXISTS (
             SELECT 1 FROM task_dependencies td
             JOIN tasks bt ON bt.id = td.blocked_by_task_id
             WHERE td.task_id = t.id AND bt.status != 'done'
           ))
     ORDER BY t.due_date IS NULL, t.due_date ASC`
  ).all<TaskRow>();

  const tasks = await Promise.all(
    results.map(async (row) => ({
      ...toSummary(row),
      blocked_by: await findRootBlockers(c.env.DB, row.id),
    }))
  );

  return c.json({ tasks });
});
