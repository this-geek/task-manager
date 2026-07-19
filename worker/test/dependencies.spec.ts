import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authed, bootstrapAdmin, createTask, issueToken } from './helpers';

async function patchTask(token: string, id: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://test/api/tasks/${id}`, authed(token, { method: 'PATCH', body: JSON.stringify(body) }));
}

describe('circular dependency guard (spec §7.1)', () => {
  let token: string;

  beforeAll(async () => {
    const adminToken = await bootstrapAdmin();
    token = await issueToken(adminToken, 'human');
  });

  it('allows a valid, acyclic dependency chain', async () => {
    const a = await createTask(token, { title: 'A' });
    const b = await createTask(token, { title: 'B' });

    const res = await patchTask(token, a.id as string, { version: a.version, dependencies: [b.id] });
    expect(res.status).toBe(200);
    const updated = await res.json<{ dependencies: string[] }>();
    expect(updated.dependencies).toEqual([b.id]);
  });

  it('rejects a direct self-dependency', async () => {
    const a = await createTask(token, { title: 'A' });

    const res = await patchTask(token, a.id as string, { version: a.version, dependencies: [a.id] });
    expect(res.status).toBe(422);
  });

  it('rejects a transitive cycle (A blocked by B, B blocked by A)', async () => {
    const a = await createTask(token, { title: 'A' });
    const b = await createTask(token, { title: 'B' });

    const first = await patchTask(token, a.id as string, { version: a.version, dependencies: [b.id] });
    expect(first.status).toBe(200);

    const second = await patchTask(token, b.id as string, { version: b.version, dependencies: [a.id] });
    expect(second.status).toBe(422);
  });

  it('rejects an unknown dependency id', async () => {
    const a = await createTask(token, { title: 'A' });

    const res = await patchTask(token, a.id as string, { version: a.version, dependencies: ['nope'] });
    expect(res.status).toBe(422);
  });
});
