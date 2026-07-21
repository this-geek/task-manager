import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, Env } from '../types';
import { requireAuth } from '../lib/auth';
import { getMcpConfig, setMcpConfig } from '../lib/settings';

const mcpPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    write_enabled: z.boolean().optional(),
  })
  .refine((v) => v.enabled !== undefined || v.write_enabled !== undefined, {
    message: 'No settings provided',
  });

export const adminSettingsRoute = new Hono<{ Bindings: Env; Variables: { actor: Actor } }>();

adminSettingsRoute.use('*', requireAuth('admin'));

adminSettingsRoute.get('/', async (c) => {
  return c.json({ mcp: await getMcpConfig(c.env.DB) });
});

adminSettingsRoute.patch('/', async (c) => {
  const parsed = mcpPatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);

  const mcp = await setMcpConfig(c.env.DB, parsed.data, c.get('actor').id);
  return c.json({ mcp });
});
