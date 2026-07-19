import { Hono } from 'hono';
import type { Env } from '../types';
import { generateToken, hashToken } from '../lib/tokens';

async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db_] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const ua = new Uint8Array(da);
  const ub = new Uint8Array(db_);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= (ua[i] as number) ^ (ub[i] as number);
  return diff === 0;
}

export const setupRoute = new Hono<{ Bindings: Env }>();

/**
 * Bootstraps the very first admin token (spec §8.4, resolved as a
 * setup-secret exchange). Gated by the SETUP_TOKEN Workers secret rather
 * than an api_tokens row, since none can exist yet. Refuses once any admin
 * token has ever been issued, so the secret can't be replayed later.
 */
setupRoute.post('/', async (c) => {
  const header = c.req.header('Authorization');
  const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!provided) return c.json({ error: 'Unauthorized' }, 401);

  if (!c.env.SETUP_TOKEN || !(await constantTimeEquals(provided, c.env.SETUP_TOKEN))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM api_tokens WHERE scope = 'admin' LIMIT 1`
  ).first();
  if (existing) {
    return c.json({ error: 'Setup already completed; an admin token already exists' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'Bootstrap Admin';

  const { plaintext, prefix } = generateToken();
  const hash = await hashToken(plaintext);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO api_tokens (id, name, token_hash, token_prefix, scope, created_by)
     VALUES (?1, ?2, ?3, ?4, 'admin', 'setup')`
  )
    .bind(id, name, hash, prefix)
    .run();

  return c.json({ id, name, scope: 'admin', token: plaintext }, 201);
});
