import { SELF } from 'cloudflare:test';

export const SETUP_SECRET = 'test-setup-secret';

export async function bootstrapAdmin(name = 'Test Admin'): Promise<string> {
  const res = await SELF.fetch('https://test/api/setup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SETUP_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await res.json<{ token: string }>();
  return body.token;
}

export async function issueToken(
  adminToken: string,
  scope: 'admin' | 'human' | 'agent',
  name = `${scope}-token`
): Promise<string> {
  const res = await SELF.fetch('https://test/api/admin/tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scope }),
  });
  const body = await res.json<{ token: string }>();
  return body.token;
}

export function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

export async function createTask(token: string, overrides: Record<string, unknown> = {}) {
  const res = await SELF.fetch(
    'https://test/api/tasks',
    authed(token, {
      method: 'POST',
      body: JSON.stringify({ title: 'Test task', ...overrides }),
    })
  );
  return res.json<Record<string, unknown>>();
}
