import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { setupRoute } from './routes/setup';
import { adminTokensRoute } from './routes/admin-tokens';
import { adminSettingsRoute } from './routes/admin-settings';
import { tasksRoute } from './routes/tasks';
import { agentRoute } from './routes/agent';
import { eventsRoute } from './routes/events';
import { handleMcp } from './mcp/server';

export { RealtimeHub } from './durable-objects/realtime-hub';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => c.env.ALLOWED_ORIGIN ?? origin ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  })
);

app.route('/api/setup', setupRoute);
app.route('/api/admin/tokens', adminTokensRoute);
app.route('/api/admin/mcp', adminSettingsRoute);
app.route('/api/tasks', tasksRoute);
app.route('/api/agent', agentRoute);
app.route('/api/events', eventsRoute);

// MCP server (Streamable HTTP, stateless). handleMcp gates on the admin toggle and
// re-enters `app` for each tools/call, reusing the real auth + guardrail path.
app.post('/api/mcp', (c) => handleMcp(c, app));
app.get('/api/mcp', (c) => c.json({ error: 'Method Not Allowed' }, 405));

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
