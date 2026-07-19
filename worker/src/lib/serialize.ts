import type { TaskDetailEntity, TaskEntity, TaskLink, TaskRow, TimeLogEntity } from '../types';
import { placeholders } from './sql';

async function loadTagsByTask(db: D1Database, taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;
  const { results } = await db
    .prepare(
      `SELECT tt.task_id AS task_id, t.name AS name
       FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
       WHERE tt.task_id IN (${placeholders(taskIds.length)})
       ORDER BY t.name`
    )
    .bind(...taskIds)
    .all<{ task_id: string; name: string }>();

  for (const row of results) {
    const list = map.get(row.task_id) ?? [];
    list.push(row.name);
    map.set(row.task_id, list);
  }
  return map;
}

async function loadLinksByTask(db: D1Database, taskIds: string[]): Promise<Map<string, TaskLink[]>> {
  const map = new Map<string, TaskLink[]>();
  if (taskIds.length === 0) return map;
  const { results } = await db
    .prepare(
      `SELECT task_id, url, label FROM task_links WHERE task_id IN (${placeholders(taskIds.length)})`
    )
    .bind(...taskIds)
    .all<{ task_id: string; url: string; label: string }>();

  for (const row of results) {
    const list = map.get(row.task_id) ?? [];
    list.push({ url: row.url, label: row.label });
    map.set(row.task_id, list);
  }
  return map;
}

async function loadDependenciesByTask(db: D1Database, taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;
  const { results } = await db
    .prepare(
      `SELECT task_id, blocked_by_task_id FROM task_dependencies WHERE task_id IN (${placeholders(taskIds.length)})`
    )
    .bind(...taskIds)
    .all<{ task_id: string; blocked_by_task_id: string }>();

  for (const row of results) {
    const list = map.get(row.task_id) ?? [];
    list.push(row.blocked_by_task_id);
    map.set(row.task_id, list);
  }
  return map;
}

async function loadActualTimeByTask(db: D1Database, taskIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (taskIds.length === 0) return map;
  const { results } = await db
    .prepare(
      `SELECT task_id, COALESCE(SUM(duration), 0) AS total
       FROM time_logs WHERE task_id IN (${placeholders(taskIds.length)})
       GROUP BY task_id`
    )
    .bind(...taskIds)
    .all<{ task_id: string; total: number }>();

  for (const row of results) map.set(row.task_id, row.total);
  return map;
}

export async function hydrateTasks(db: D1Database, rows: TaskRow[]): Promise<TaskEntity[]> {
  const ids = rows.map((r) => r.id);
  const [tags, links, deps, actualTime] = await Promise.all([
    loadTagsByTask(db, ids),
    loadLinksByTask(db, ids),
    loadDependenciesByTask(db, ids),
    loadActualTimeByTask(db, ids),
  ]);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    due_date: row.due_date,
    category: row.category,
    assignee: row.assignee,
    tags: tags.get(row.id) ?? [],
    links: links.get(row.id) ?? [],
    dependencies: deps.get(row.id) ?? [],
    estimated_time: row.estimated_time,
    actual_time: actualTime.get(row.id) ?? 0,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function hydrateTaskDetail(db: D1Database, row: TaskRow): Promise<TaskDetailEntity> {
  const [entities, timeLogs] = await Promise.all([
    hydrateTasks(db, [row]),
    db
      .prepare(
        `SELECT id, duration, notes, logged_at FROM time_logs WHERE task_id = ?1 ORDER BY logged_at DESC`
      )
      .bind(row.id)
      .all<TimeLogEntity>()
      .then((r) => r.results),
  ]);

  return { ...(entities[0] as TaskEntity), time_logs: timeLogs };
}

export async function existingTaskIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const { results } = await db
    .prepare(`SELECT id FROM tasks WHERE id IN (${placeholders(unique.length)})`)
    .bind(...unique)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}
