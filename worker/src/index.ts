import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { setupRoute } from './routes/setup';
import { adminTokensRoute } from './routes/admin-tokens';
import { tasksRoute } from './routes/tasks';
import { agentRoute } from './routes/agent';
import { eventsRoute } from './routes/events';

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
app.route('/api/tasks', tasksRoute);
app.route('/api/agent', agentRoute);
app.route('/api/events', eventsRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
