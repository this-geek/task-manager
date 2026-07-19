import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authed, bootstrapAdmin, createTask, issueToken } from './helpers';

describe('tasks CRUD', () => {
  let token: string;

  beforeAll(async () => {
    const adminToken = await bootstrapAdmin();
    token = await issueToken(adminToken, 'human');
  });

  describe('POST /api/tasks', () => {
    it('creates a task with server-owned timestamps and version', async () => {
      const task = await createTask(token, { title: 'Ship the thing', category: 'Engineering' });

      expect(task.id).toBeTruthy();
      expect(task.version).toBe(1);
      expect(task.status).toBe('backlog');
      expect(task.created_at).toBeTruthy();
      expect(task.time_logs).toEqual([]);
    });

    it('ignores client-supplied created_at/updated_at (spec §7.2)', async () => {
      const task = await createTask(token, {
        title: 'Faked timestamps',
        created_at: '1999-01-01T00:00:00.000Z',
        updated_at: '1999-01-01T00:00:00.000Z',
      });
      expect(task.created_at).not.toContain('1999');
    });

    it('strips raw HTML from descriptions (spec §7.3)', async () => {
      const task = await createTask(token, {
        title: 'XSS attempt',
        description: '<script>alert(1)</script>Hello **world**',
      });
      expect(task.description).not.toContain('<script>');
      expect(task.description).toContain('Hello **world**');
    });

    it('persists tags and links', async () => {
      const task = await createTask(token, {
        title: 'Tagged task',
        tags: ['urgent', 'backend'],
        links: [{ url: 'https://example.com/doc', label: 'Design doc' }],
      });
      expect(task.tags).toEqual(['backend', 'urgent']);
      expect(task.links).toEqual([{ url: 'https://example.com/doc', label: 'Design doc' }]);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('404s for an unknown id', async () => {
      const res = await SELF.fetch('https://test/api/tasks/does-not-exist', authed(token));
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/tasks/:id (optimistic concurrency, spec §8.1)', () => {
    it('applies an update and increments version', async () => {
      const task = await createTask(token);

      const res = await SELF.fetch(
        `https://test/api/tasks/${task.id}`,
        authed(token, { method: 'PATCH', body: JSON.stringify({ version: task.version, status: 'in_progress' }) })
      );
      expect(res.status).toBe(200);
      const updated = await res.json<Record<string, unknown>>();
      expect(updated.status).toBe('in_progress');
      expect(updated.version).toBe(2);
    });

    it('rejects a stale version with 409', async () => {
      const task = await createTask(token);

      await SELF.fetch(
        `https://test/api/tasks/${task.id}`,
        authed(token, { method: 'PATCH', body: JSON.stringify({ version: task.version, status: 'todo' }) })
      );

      const staleRes = await SELF.fetch(
        `https://test/api/tasks/${task.id}`,
        authed(token, { method: 'PATCH', body: JSON.stringify({ version: task.version, status: 'done' }) })
      );
      expect(staleRes.status).toBe(409);
    });

    it('requires version in the request body', async () => {
      const task = await createTask(token);

      const res = await SELF.fetch(
        `https://test/api/tasks/${task.id}`,
        authed(token, { method: 'PATCH', body: JSON.stringify({ status: 'todo' }) })
      );
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('deletes the task and it becomes unreachable', async () => {
      const task = await createTask(token);

      const del = await SELF.fetch(`https://test/api/tasks/${task.id}`, authed(token, { method: 'DELETE' }));
      expect(del.status).toBe(204);

      const getRes = await SELF.fetch(`https://test/api/tasks/${task.id}`, authed(token));
      expect(getRes.status).toBe(404);
    });
  });

  describe('POST /api/tasks/:id/time-logs', () => {
    it('logs time and aggregates into actual_time', async () => {
      const task = await createTask(token);

      await SELF.fetch(
        `https://test/api/tasks/${task.id}/time-logs`,
        authed(token, { method: 'POST', body: JSON.stringify({ duration: 30, notes: 'Half an hour' }) })
      );
      const res = await SELF.fetch(
        `https://test/api/tasks/${task.id}/time-logs`,
        authed(token, { method: 'POST', body: JSON.stringify({ duration: 15 }) })
      );
      const updated = await res.json<{ actual_time: number; time_logs: unknown[] }>();
      expect(updated.actual_time).toBe(45);
      expect(updated.time_logs).toHaveLength(2);
    });
  });
});
