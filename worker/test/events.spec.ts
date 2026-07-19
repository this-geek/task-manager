import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { bootstrapAdmin } from './helpers';

describe('GET /api/events (SSE, spec §8.2)', () => {
  it('rejects a missing token', async () => {
    const res = await SELF.fetch('https://test/api/events');
    expect(res.status).toBe(401);
  });

  it('opens an event-stream for a valid token passed as a query param', async () => {
    const token = await bootstrapAdmin();
    const res = await SELF.fetch(`https://test/api/events?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    await res.body?.cancel();
  });
});
