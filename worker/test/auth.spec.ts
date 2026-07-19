import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authed, bootstrapAdmin, issueToken } from './helpers';

describe('bearer token validation flow (spec §5.2)', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await bootstrapAdmin();
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await SELF.fetch('https://test/api/tasks');
    expect(res.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const res = await SELF.fetch('https://test/api/tasks', authed('tm_live_does-not-exist'));
    expect(res.status).toBe(401);
  });

  it('rejects a revoked token', async () => {
    const humanToken = await issueToken(adminToken, 'human', 'revoke-me');

    const listRes = await SELF.fetch('https://test/api/admin/tokens', authed(adminToken));
    const { tokens } = await listRes.json<{ tokens: Array<{ id: string; token_prefix: string }> }>();
    const humanRow = tokens.find((t) => humanToken.startsWith(t.token_prefix));
    expect(humanRow).toBeTruthy();

    await SELF.fetch(`https://test/api/admin/tokens/${humanRow!.id}`, authed(adminToken, { method: 'DELETE' }));

    const res = await SELF.fetch('https://test/api/tasks', authed(humanToken));
    expect(res.status).toBe(401);
  });

  it('returns 403 when an agent-scoped token calls an admin route', async () => {
    const agentToken = await issueToken(adminToken, 'agent', 'scope-check-agent');

    const res = await SELF.fetch('https://test/api/admin/tokens', authed(agentToken));
    expect(res.status).toBe(403);
  });

  it('allows human and agent scopes through /api/tasks', async () => {
    const humanToken = await issueToken(adminToken, 'human', 'scope-check-human');
    const agentToken = await issueToken(adminToken, 'agent', 'scope-check-agent-2');

    const humanRes = await SELF.fetch('https://test/api/tasks', authed(humanToken));
    expect(humanRes.status).toBe(200);

    const agentRes = await SELF.fetch('https://test/api/tasks', authed(agentToken));
    expect(agentRes.status).toBe(200);
  });

  it('rate-limits agent-scoped tokens at 60 requests/minute (spec §5.2)', async () => {
    const agentToken = await issueToken(adminToken, 'agent', 'rate-limited-agent');

    let sawTooManyRequests = false;
    for (let i = 0; i < 61; i++) {
      const res = await SELF.fetch('https://test/api/agent/agenda', authed(agentToken));
      if (res.status === 429) {
        sawTooManyRequests = true;
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(sawTooManyRequests).toBe(true);
  });
});
