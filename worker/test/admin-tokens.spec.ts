import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authed, bootstrapAdmin, issueToken } from './helpers';

describe('admin token lifecycle (spec §5.3)', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await bootstrapAdmin();
  });

  it('lists tokens without ever exposing token_hash', async () => {
    await issueToken(adminToken, 'agent', 'list-check-agent');

    const res = await SELF.fetch('https://test/api/admin/tokens', authed(adminToken));
    const { tokens } = await res.json<{ tokens: Array<Record<string, unknown>> }>();
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    for (const t of tokens) {
      expect(t.token_hash).toBeUndefined();
    }
  });

  it('rotate revokes the old token and returns a new plaintext once', async () => {
    const agentToken = await issueToken(adminToken, 'agent', 'rotate-me');

    const listRes = await SELF.fetch('https://test/api/admin/tokens', authed(adminToken));
    const { tokens } = await listRes.json<{ tokens: Array<{ id: string; token_prefix: string; scope: string }> }>();
    const agentRow = tokens.find((t) => agentToken.startsWith(t.token_prefix));
    expect(agentRow).toBeTruthy();

    const rotateRes = await SELF.fetch(
      `https://test/api/admin/tokens/${agentRow!.id}/rotate`,
      authed(adminToken, { method: 'POST' })
    );
    expect(rotateRes.status).toBe(201);
    const rotated = await rotateRes.json<{ token: string }>();
    expect(rotated.token).not.toBe(agentToken);

    const oldRes = await SELF.fetch('https://test/api/tasks', authed(agentToken));
    expect(oldRes.status).toBe(401);

    const newRes = await SELF.fetch('https://test/api/tasks', authed(rotated.token));
    expect(newRes.status).toBe(200);
  });

  it('revoke takes effect immediately', async () => {
    const humanToken = await issueToken(adminToken, 'human', 'revoke-check-human');

    const listRes = await SELF.fetch('https://test/api/admin/tokens', authed(adminToken));
    const { tokens } = await listRes.json<{ tokens: Array<{ id: string; token_prefix: string; scope: string }> }>();
    const humanRow = tokens.find((t) => humanToken.startsWith(t.token_prefix));

    const revokeRes = await SELF.fetch(
      `https://test/api/admin/tokens/${humanRow!.id}`,
      authed(adminToken, { method: 'DELETE' })
    );
    expect(revokeRes.status).toBe(200);

    const res = await SELF.fetch('https://test/api/tasks', authed(humanToken));
    expect(res.status).toBe(401);
  });
});
