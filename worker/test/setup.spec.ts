import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SETUP_SECRET, bootstrapAdmin } from './helpers';

describe('POST /api/setup', () => {
  it('rejects a missing or wrong bearer token', async () => {
    const noAuth = await SELF.fetch('https://test/api/setup', { method: 'POST' });
    expect(noAuth.status).toBe(401);

    const wrongAuth = await SELF.fetch('https://test/api/setup', {
      method: 'POST',
      headers: { Authorization: 'Bearer nope' },
    });
    expect(wrongAuth.status).toBe(401);
  });

  it('mints the first admin token', async () => {
    const res = await SELF.fetch('https://test/api/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SETUP_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First Admin' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ token: string; scope: string }>();
    expect(body.scope).toBe('admin');
    expect(body.token).toMatch(/^tm_live_/);
  });

  it('refuses to run again once an admin token exists', async () => {
    await bootstrapAdmin();

    const res = await SELF.fetch('https://test/api/setup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SETUP_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second Admin' }),
    });
    expect(res.status).toBe(403);
  });
});
