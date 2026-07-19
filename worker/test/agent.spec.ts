import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authed, bootstrapAdmin, createTask, issueToken } from './helpers';

async function patchTask(token: string, id: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://test/api/tasks/${id}`, authed(token, { method: 'PATCH', body: JSON.stringify(body) }));
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe('agent-optimized endpoints (spec §4.2)', () => {
  let token: string;

  beforeAll(async () => {
    const adminToken = await bootstrapAdmin();
    token = await issueToken(adminToken, 'human');
  });

  describe('GET /api/agent/agenda', () => {
    it('returns only overdue/due-today, non-done tasks, ascending by due date', async () => {
      const overdue = await createTask(token, { title: 'Overdue', due_date: isoDate(-1) });
      await createTask(token, { title: 'Future', due_date: isoDate(5) });
      const dueToday = await createTask(token, { title: 'Due today', due_date: isoDate(0) });
      const doneOverdue = await createTask(token, { title: 'Done overdue', due_date: isoDate(-2) });
      await patchTask(token, doneOverdue.id as string, { version: doneOverdue.version, status: 'done' });

      const res = await SELF.fetch('https://test/api/agent/agenda', authed(token));
      const { tasks } = await res.json<{ tasks: Array<{ id: string }> }>();
      const ids = tasks.map((t) => t.id);

      expect(ids).toContain(overdue.id);
      expect(ids).toContain(dueToday.id);
      expect(ids).not.toContain(doneOverdue.id);
      expect(ids.indexOf(overdue.id as string)).toBeLessThan(ids.indexOf(dueToday.id as string));
    });
  });

  describe('GET /api/agent/actionable', () => {
    it('excludes tasks blocked by an incomplete dependency', async () => {
      const blocker = await createTask(token, { title: 'Blocker', status: 'todo' });
      const blocked = await createTask(token, { title: 'Blocked', status: 'todo' });
      await patchTask(token, blocked.id as string, { version: blocked.version, dependencies: [blocker.id] });

      const res = await SELF.fetch('https://test/api/agent/actionable', authed(token));
      const { tasks } = await res.json<{ tasks: Array<{ id: string }> }>();
      const ids = tasks.map((t) => t.id);

      expect(ids).toContain(blocker.id);
      expect(ids).not.toContain(blocked.id);
    });

    it('includes a task once its blocker is done', async () => {
      const blocker = await createTask(token, { title: 'Blocker2', status: 'todo' });
      const blocked = await createTask(token, { title: 'Blocked2', status: 'todo' });
      const withDep = await patchTask(token, blocked.id as string, {
        version: blocked.version,
        dependencies: [blocker.id],
      }).then((r) => r.json<{ version: number }>());

      await patchTask(token, blocker.id as string, { version: blocker.version, status: 'done' });

      const res = await SELF.fetch('https://test/api/agent/actionable', authed(token));
      const { tasks } = await res.json<{ tasks: Array<{ id: string }> }>();
      expect(tasks.map((t) => t.id)).toContain(blocked.id);
      expect(withDep.version).toBe(2);
    });
  });

  describe('GET /api/agent/blocked', () => {
    it('reports the root blocker for a transitively blocked task', async () => {
      const root = await createTask(token, { title: 'Root blocker', status: 'todo' });
      const middle = await createTask(token, { title: 'Middle', status: 'todo' });
      const leaf = await createTask(token, { title: 'Leaf', status: 'blocked' });

      await patchTask(token, middle.id as string, { version: middle.version, dependencies: [root.id] });
      await patchTask(token, leaf.id as string, { version: leaf.version, dependencies: [middle.id] });

      const res = await SELF.fetch('https://test/api/agent/blocked', authed(token));
      const { tasks } = await res.json<{ tasks: Array<{ id: string; blocked_by: Array<{ id: string }> }> }>();

      const leafEntry = tasks.find((t) => t.id === leaf.id);
      expect(leafEntry).toBeTruthy();
      expect(leafEntry!.blocked_by.map((b) => b.id)).toEqual([root.id]);
    });
  });
});
