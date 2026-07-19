import { Hono } from 'hono';
import type { Env } from '../types';
import { touchLastUsed, validateToken } from '../lib/auth';
import { subscribeToHub } from '../lib/realtime';

export const eventsRoute = new Hono<{ Bindings: Env }>();

/**
 * SSE feed for spec §8.2 real-time sync. Browser EventSource can't set an
 * Authorization header, so this is the one endpoint where the bearer token
 * travels as a query param instead — it still goes through the same
 * hash-lookup/scope validation as every other route (§5.2), just with a
 * different extraction point.
 */
eventsRoute.get('/', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const actor = await validateToken(c.env.DB, token);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  c.executionCtx.waitUntil(touchLastUsed(c.env.DB, actor.id));

  return subscribeToHub(c.env);
});
