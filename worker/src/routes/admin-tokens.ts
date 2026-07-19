import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, Env } from '../types';
import { requireAuth } from '../lib/auth';
import { generateToken, hashToken } from '../lib/tokens';

const TOKEN_FIELDS = `id, name, token_prefix, scope, created_by, expires_at, last_used_at, revoked_at, created_at`;

const issueSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scope: z.enum(['admin', 'human', 'agent']),
  expires_at: z.string().datetime().nullish(),
});

export const adminTokensRoute = new Hono<{ Bindings: Env; Variables: { actor: Actor } }>();

adminTokensRoute.use('*', requireAuth('admin'));

adminTokensRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${TOKEN_FIELDS} FROM api_tokens ORDER BY created_at DESC`).all();
  return c.json({ tokens: results });
});

adminTokensRoute.post('/', async (c) => {
  const parsed = issueSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
  const { name, scope, expires_at: expiresAt } = parsed.data;

  const actor = c.get('actor');
  const { plaintext, prefix } = generateToken();
  const hash = await hashToken(plaintext);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO api_tokens (id, name, token_hash, token_prefix, scope, created_by, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(id, name, hash, prefix, scope, actor.id, expiresAt ?? null)
    .run();

  const row = await c.env.DB.prepare(`SELECT ${TOKEN_FIELDS} FROM api_tokens WHERE id = ?1`).bind(id).first();
  return c.json({ ...row, token: plaintext }, 201);
});

adminTokensRoute.post('/:id/rotate', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT * FROM api_tokens WHERE id = ?1`).bind(id).first<{
    name: string;
    scope: 'admin' | 'human' | 'agent';
    expires_at: string | null;
    revoked_at: string | null;
  }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const actor = c.get('actor');
  const { plaintext, prefix } = generateToken();
  const hash = await hashToken(plaintext);
  const newId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE api_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO api_tokens (id, name, token_hash, token_prefix, scope, created_by, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(newId, existing.name, hash, prefix, existing.scope, actor.id, existing.expires_at),
  ]);

  const row = await c.env.DB.prepare(`SELECT ${TOKEN_FIELDS} FROM api_tokens WHERE id = ?1`).bind(newId).first();
  return c.json({ ...row, token: plaintext }, 201);
});

adminTokensRoute.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT id, revoked_at FROM api_tokens WHERE id = ?1`).bind(id).first<{
    id: string;
    revoked_at: string | null;
  }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.revoked_at) return c.json({ error: 'Already revoked' }, 409);

  await c.env.DB.prepare(`UPDATE api_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1`)
    .bind(id)
    .run();

  const row = await c.env.DB.prepare(`SELECT ${TOKEN_FIELDS} FROM api_tokens WHERE id = ?1`).bind(id).first();
  return c.json(row);
});
