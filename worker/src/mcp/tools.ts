export type ToolCategory = 'read' | 'write';

export interface DispatchTarget {
  method: string;
  path: string;
  body?: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  dispatch: (args: Record<string, unknown>) => DispatchTarget;
}

const STATUS_ENUM = ['backlog', 'todo', 'in_progress', 'blocked', 'done'];

function queryString(args: Record<string, unknown>, keys: string[]): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.length) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// Tool bodies are forwarded verbatim to the existing REST handlers, which own all
// validation and guardrails (OCC, cycle detection, sanitization, audit, realtime).
// These tools add no logic — they are a transport shim, so descriptions surface the
// guardrails the caller must handle rather than re-implementing them.
export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_tasks',
    description: 'List tasks, optionally filtered by status, assignee, or category (all exact-match).',
    category: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: STATUS_ENUM },
        assignee: { type: 'string' },
        category: { type: 'string' },
      },
    },
    dispatch: (args) => ({ method: 'GET', path: `/api/tasks${queryString(args, ['status', 'assignee', 'category'])}` }),
  },
  {
    name: 'get_task',
    description: 'Get the full detail of one task by id, including its time logs.',
    category: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    dispatch: (args) => ({ method: 'GET', path: `/api/tasks/${encodeURIComponent(String(args.id))}` }),
  },
  {
    name: 'agenda',
    description: 'Lean list of tasks due today or overdue and not done, soonest first.',
    category: 'read',
    inputSchema: { type: 'object', properties: {} },
    dispatch: () => ({ method: 'GET', path: '/api/agent/agenda' }),
  },
  {
    name: 'actionable',
    description: 'Lean list of todo/in_progress tasks with no incomplete dependency — safe to start now.',
    category: 'read',
    inputSchema: { type: 'object', properties: {} },
    dispatch: () => ({ method: 'GET', path: '/api/agent/actionable' }),
  },
  {
    name: 'blocked',
    description: 'Lean list of blocked tasks, each with a blocked_by array naming the root-cause blocker(s).',
    category: 'read',
    inputSchema: { type: 'object', properties: {} },
    dispatch: () => ({ method: 'GET', path: '/api/agent/blocked' }),
  },
  {
    name: 'create_task',
    description: 'Create a task. Only title is required. Setting a dependency that forms a cycle is rejected (422).',
    category: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: STATUS_ENUM },
        category: { type: 'string' },
        assignee: { type: 'string' },
        estimated_time: { type: 'integer', description: 'Minutes.' },
        due_date: { type: 'string', description: 'YYYY-MM-DD.' },
        tags: { type: 'array', items: { type: 'string' } },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: { url: { type: 'string' }, label: { type: 'string' } },
            required: ['url', 'label'],
          },
        },
        dependencies: { type: 'array', items: { type: 'string' }, description: 'Task ids this task is blocked by.' },
      },
      required: ['title'],
    },
    dispatch: (args) => ({ method: 'POST', path: '/api/tasks', body: args }),
  },
  {
    name: 'update_task',
    description:
      'Partial update of a task. version is REQUIRED and must match the last version you saw; a mismatch returns 409 with the current entity — re-read it, decide if your change still applies, and retry with the new version. Setting tags/links/dependencies replaces the whole array.',
    category: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        version: { type: 'integer', description: 'The version you last saw for this task.' },
        title: { type: 'string' },
        description: { type: ['string', 'null'] },
        status: { type: 'string', enum: STATUS_ENUM },
        category: { type: 'string' },
        assignee: { type: ['string', 'null'] },
        estimated_time: { type: 'integer', description: 'Minutes.' },
        due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD.' },
        tags: { type: 'array', items: { type: 'string' } },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: { url: { type: 'string' }, label: { type: 'string' } },
            required: ['url', 'label'],
          },
        },
        dependencies: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'version'],
    },
    dispatch: ({ id, ...body }) => ({ method: 'PATCH', path: `/api/tasks/${encodeURIComponent(String(id))}`, body }),
  },
  {
    name: 'delete_task',
    description: 'Delete a task by id.',
    category: 'write',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    dispatch: (args) => ({ method: 'DELETE', path: `/api/tasks/${encodeURIComponent(String(args.id))}` }),
  },
  {
    name: 'log_time',
    description: 'Append a time log to a task. duration is in minutes.',
    category: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        duration: { type: 'integer', description: 'Minutes.' },
        notes: { type: 'string' },
      },
      required: ['id', 'duration'],
    },
    dispatch: ({ id, ...body }) => ({
      method: 'POST',
      path: `/api/tasks/${encodeURIComponent(String(id))}/time-logs`,
      body,
    }),
  },
];
