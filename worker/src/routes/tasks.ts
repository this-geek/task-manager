import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, Env, TaskRow } from '../types';
import { requireAuth } from '../lib/auth';
import { sanitizeDescription } from '../lib/sanitize';
import { findCyclicDependency } from '../lib/cycle-check';
import { auditStatement } from '../lib/audit';
import { hydrateTaskDetail, hydrateTasks, existingTaskIds } from '../lib/serialize';
import { upsertTagIds } from '../lib/tags';
import { publishTaskEvent } from '../lib/realtime';

const STATUS_VALUES = ['backlog', 'todo', 'in_progress', 'blocked', 'done'] as const;
const statusEnum = z.enum(STATUS_VALUES);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const linkSchema = z.object({ url: z.string().url().max(2000), label: z.string().trim().min(1).max(200) });

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(50_000).nullish(),
  status: statusEnum.default('backlog'),
  category: z.string().trim().min(1).max(100).default('General'),
  assignee: z.string().trim().max(200).nullish(),
  estimated_time: z.number().int().min(0).default(0),
  due_date: dateOnly.nullish(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
  links: z.array(linkSchema).max(50).default([]),
  dependencies: z.array(z.string().min(1).max(100)).max(200).default([]),
});

const patchTaskSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(50_000).nullable().optional(),
  status: statusEnum.optional(),
  category: z.string().trim().min(1).max(100).optional(),
  assignee: z.string().trim().max(200).nullable().optional(),
  estimated_time: z.number().int().min(0).optional(),
  due_date: dateOnly.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  links: z.array(linkSchema).max(50).optional(),
  dependencies: z.array(z.string().min(1).max(100)).max(200).optional(),
});

const timeLogSchema = z.object({
  duration: z.number().int().positive(),
  notes: z.string().max(2000).nullish(),
});

export const tasksRoute = new Hono<{ Bindings: Env; Variables: { actor: Actor } }>();

tasksRoute.use('*', requireAuth('admin', 'human', 'agent'));

tasksRoute.get('/', async (c) => {
  const status = c.req.query('status');
  const assignee = c.req.query('assignee');
  const category = c.req.query('category');

  if (status && !statusEnum.safeParse(status).success) {
    return c.json({ error: `Invalid status filter. Expected one of: ${STATUS_VALUES.join(', ')}` }, 400);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    conditions.push(`status = ?${params.length}`);
  }
  if (assignee) {
    params.push(assignee);
    conditions.push(`assignee = ?${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`category = ?${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`)
    .bind(...params)
    .all<TaskRow>();

  const tasks = await hydrateTasks(c.env.DB, results);
  return c.json({ tasks });
});

tasksRoute.post('/', async (c) => {
  const parsed = createTaskSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
  const data = parsed.data;

  if (data.dependencies.length) {
    const found = await existingTaskIds(c.env.DB, data.dependencies);
    const missing = [...new Set(data.dependencies)].filter((depId) => !found.has(depId));
    if (missing.length) return c.json({ error: `Unknown dependency task id(s): ${missing.join(', ')}` }, 422);
  }

  const id = crypto.randomUUID();
  const description = sanitizeDescription(data.description);
  const actor = c.get('actor');

  const statements = [
    c.env.DB.prepare(
      `INSERT INTO tasks (id, title, description, status, category, assignee, estimated_time, due_date)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(id, data.title, description, data.status, data.category, data.assignee ?? null, data.estimated_time, data.due_date ?? null),
    auditStatement(c.env.DB, actor, { actionType: 'INSERT', taskId: id, newValue: data.title }),
  ];

  if (data.tags.length) {
    const tagIds = await upsertTagIds(c.env.DB, data.tags);
    for (const tagId of tagIds) {
      statements.push(
        c.env.DB.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)').bind(id, tagId)
      );
    }
  }
  for (const link of data.links) {
    statements.push(
      c.env.DB
        .prepare('INSERT INTO task_links (id, task_id, url, label) VALUES (?1, ?2, ?3, ?4)')
        .bind(crypto.randomUUID(), id, link.url, link.label)
    );
  }
  for (const dep of new Set(data.dependencies)) {
    statements.push(
      c.env.DB.prepare('INSERT INTO task_dependencies (task_id, blocked_by_task_id) VALUES (?1, ?2)').bind(id, dep)
    );
  }

  await c.env.DB.batch(statements);

  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id).first<TaskRow>();
  const entity = await hydrateTaskDetail(c.env.DB, row!);
  c.executionCtx.waitUntil(publishTaskEvent(c.env, 'task.created', entity));
  return c.json(entity, 201);
});

tasksRoute.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(c.req.param('id')).first<TaskRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(await hydrateTaskDetail(c.env.DB, row));
});

tasksRoute.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const parsed = patchTaskSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
  const data = parsed.data;

  const current = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id).first<TaskRow>();
  if (!current) return c.json({ error: 'Not found' }, 404);

  if (data.version !== current.version) {
    return c.json({ error: 'Version conflict', current: await hydrateTaskDetail(c.env.DB, current) }, 409);
  }

  let uniqueDeps: string[] | undefined;
  if (data.dependencies) {
    uniqueDeps = [...new Set(data.dependencies)];
    const found = await existingTaskIds(c.env.DB, uniqueDeps);
    const missing = uniqueDeps.filter((depId) => !found.has(depId));
    if (missing.length) return c.json({ error: `Unknown dependency task id(s): ${missing.join(', ')}` }, 422);

    const cyclic = await findCyclicDependency(c.env.DB, id, uniqueDeps);
    if (cyclic) {
      return c.json({ error: `Setting dependency on ${cyclic} would create a circular dependency` }, 422);
    }
  }

  const actor = c.get('actor');
  const scalarSets: string[] = [];
  const scalarParams: unknown[] = [];
  const auditStatements: D1PreparedStatement[] = [];

  const setField = (column: string, newValue: unknown, oldValue: unknown) => {
    scalarParams.push(newValue);
    scalarSets.push(`${column} = ?${scalarParams.length}`);
    auditStatements.push(
      auditStatement(c.env.DB, actor, {
        actionType: 'UPDATE',
        taskId: id,
        fieldChanged: column,
        oldValue: oldValue == null ? null : String(oldValue),
        newValue: newValue == null ? null : String(newValue),
      })
    );
  };

  if (data.title !== undefined && data.title !== current.title) setField('title', data.title, current.title);
  if (data.description !== undefined) {
    const sanitized = sanitizeDescription(data.description);
    if (sanitized !== current.description) setField('description', sanitized, current.description);
  }
  if (data.status !== undefined && data.status !== current.status) setField('status', data.status, current.status);
  if (data.category !== undefined && data.category !== current.category) setField('category', data.category, current.category);
  if (data.assignee !== undefined && data.assignee !== current.assignee) setField('assignee', data.assignee, current.assignee);
  if (data.estimated_time !== undefined && data.estimated_time !== current.estimated_time) {
    setField('estimated_time', data.estimated_time, current.estimated_time);
  }
  if (data.due_date !== undefined && data.due_date !== current.due_date) setField('due_date', data.due_date, current.due_date);

  const statements = [];
  const touchesRelations = data.tags !== undefined || data.links !== undefined || uniqueDeps !== undefined;

  if (scalarSets.length) {
    scalarParams.push(id, data.version);
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE tasks SET ${scalarSets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1
           WHERE id = ?${scalarParams.length - 1} AND version = ?${scalarParams.length}`
        )
        .bind(...scalarParams)
    );
    statements.push(...auditStatements);
  } else if (touchesRelations) {
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1
           WHERE id = ?1 AND version = ?2`
        )
        .bind(id, data.version)
    );
  }

  if (data.tags !== undefined) {
    statements.push(c.env.DB.prepare('DELETE FROM task_tags WHERE task_id = ?1').bind(id));
    const tagIds = await upsertTagIds(c.env.DB, data.tags);
    for (const tagId of tagIds) {
      statements.push(
        c.env.DB.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)').bind(id, tagId)
      );
    }
  }

  if (data.links !== undefined) {
    statements.push(c.env.DB.prepare('DELETE FROM task_links WHERE task_id = ?1').bind(id));
    for (const link of data.links) {
      statements.push(
        c.env.DB
          .prepare('INSERT INTO task_links (id, task_id, url, label) VALUES (?1, ?2, ?3, ?4)')
          .bind(crypto.randomUUID(), id, link.url, link.label)
      );
    }
  }

  if (uniqueDeps !== undefined) {
    statements.push(c.env.DB.prepare('DELETE FROM task_dependencies WHERE task_id = ?1').bind(id));
    for (const dep of uniqueDeps) {
      statements.push(
        c.env.DB.prepare('INSERT INTO task_dependencies (task_id, blocked_by_task_id) VALUES (?1, ?2)').bind(id, dep)
      );
    }
  }

  if (statements.length === 0) {
    return c.json(await hydrateTaskDetail(c.env.DB, current));
  }

  const results = await c.env.DB.batch(statements);
  if ((scalarSets.length || touchesRelations) && results[0]?.meta.changes === 0) {
    const fresh = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id).first<TaskRow>();
    return c.json({ error: 'Version conflict', current: await hydrateTaskDetail(c.env.DB, fresh!) }, 409);
  }

  const fresh = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id).first<TaskRow>();
  const entity = await hydrateTaskDetail(c.env.DB, fresh!);
  c.executionCtx.waitUntil(publishTaskEvent(c.env, 'task.updated', entity));
  return c.json(entity);
});

tasksRoute.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const current = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id).first<TaskRow>();
  if (!current) return c.json({ error: 'Not found' }, 404);

  const actor = c.get('actor');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM tasks WHERE id = ?1').bind(id),
    auditStatement(c.env.DB, actor, { actionType: 'DELETE', taskId: id, oldValue: current.title }),
  ]);

  c.executionCtx.waitUntil(publishTaskEvent(c.env, 'task.deleted', { id }));
  return c.body(null, 204);
});

tasksRoute.post('/:id/time-logs', async (c) => {
  const id = c.req.param('id');
  const exists = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ?1').bind(id).first();
  if (!exists) return c.json({ error: 'Not found' }, 404);

  const parsed = timeLogSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
  const { duration, notes } = parsed.data;

  const logId = crypto.randomUUID();
  const actor = c.get('actor');
  await c.env.DB.batch([
    c.env.DB
      .prepare('INSERT INTO time_logs (id, task_id, duration, notes) VALUES (?1, ?2, ?3, ?4)')
      .bind(logId, id, duration, notes ?? null),
    auditStatement(c.env.DB, actor, { actionType: 'INSERT', taskId: id, fieldChanged: 'time_logs', newValue: `+${duration}m` }),
  ]);

  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id).first<TaskRow>();
  const entity = await hydrateTaskDetail(c.env.DB, row!);
  c.executionCtx.waitUntil(publishTaskEvent(c.env, 'task.updated', entity));
  return c.json(entity, 201);
});
