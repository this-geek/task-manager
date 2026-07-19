import type { Context, Next } from 'hono';
import type { Actor, Env, TokenScope } from '../types';
import { hashToken } from './tokens';

interface TokenRow {
  id: string;
  scope: TokenScope;
  revoked_at: string | null;
  expires_at: string | null;
}

/** Core of spec §5.2 steps 1-2: hash-lookup, reject missing/revoked/expired. */
export async function validateToken(db: D1Database, plaintext: string): Promise<Actor | null> {
  const hash = await hashToken(plaintext);
  const row = await db
    .prepare('SELECT id, scope, revoked_at, expires_at FROM api_tokens WHERE token_hash = ?1')
    .bind(hash)
    .first<TokenRow>();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at <= new Date().toISOString()) return null;

  return { id: row.id, scope: row.scope };
}

export function touchLastUsed(db: D1Database, tokenId: string): Promise<D1Result> {
  return db
    .prepare(`UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1`)
    .bind(tokenId)
    .run();
}

export type AuthedContext = Context<{ Bindings: Env; Variables: { actor: Actor } }>;

/**
 * Hono middleware implementing the full §5.2 request validation flow:
 * hash-lookup -> 401, scope check -> 403, best-effort last_used_at touch,
 * then per-token rate limiting for agent-scoped callers -> 429.
 */
export function requireAuth(...allowedScopes: TokenScope[]) {
  return async (c: AuthedContext, next: Next) => {
    const header = c.req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const actor = await validateToken(c.env.DB, token);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    if (!allowedScopes.includes(actor.scope)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    c.set('actor', actor);
    c.executionCtx.waitUntil(touchLastUsed(c.env.DB, actor.id));

    if (actor.scope === 'agent') {
      const outcome = await c.env.AGENT_RATE_LIMITER.limit({ key: actor.id });
      if (!outcome.success) {
        return c.json({ error: 'Too Many Requests' }, 429);
      }
    }

    await next();
  };
}
