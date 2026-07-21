import type { Context, Hono } from 'hono';
import type { Env } from '../types';
import { validateToken } from '../lib/auth';
import { getMcpConfig, type McpConfig } from '../lib/settings';
import { MCP_TOOLS, type McpTool } from './tools';

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
const SERVER_INFO = { name: 'task-manager-mcp', version: '0.1.0' };

type Id = string | number | null;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

function ok(id: Id, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: Id, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function availableTools(config: McpConfig): McpTool[] {
  return config.write_enabled ? MCP_TOOLS : MCP_TOOLS.filter((t) => t.category === 'read');
}

function toolContent(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

/**
 * Streamable-HTTP MCP endpoint. Stateless: every JSON-RPC request is answered with a
 * single application/json response (no SSE session), which suits a Worker.
 * Tools are a transport shim — tools/call re-enters the same Hono app so every request
 * goes through the real auth + guardrail path exactly once.
 */
export async function handleMcp(c: Context<{ Bindings: Env }>, app: Hono<{ Bindings: Env }>): Promise<Response> {
  const config = await getMcpConfig(c.env.DB);
  if (!config.enabled) {
    return c.json({ error: 'MCP server is disabled' }, 503);
  }

  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token || !(await validateToken(c.env.DB, token))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let payload: JsonRpcMessage | JsonRpcMessage[];
  try {
    payload = await c.req.json();
  } catch {
    return c.json(fail(null, -32700, 'Parse error'), 400);
  }

  const messages = Array.isArray(payload) ? payload : [payload];

  async function dispatchTool(name: string, args: Record<string, unknown>) {
    const tool = availableTools(config).find((t) => t.name === name);
    if (!tool) {
      const known = MCP_TOOLS.some((t) => t.name === name);
      return toolContent(known ? `Tool "${name}" is disabled (write access is off).` : `Unknown tool: ${name}`, true);
    }

    const { method, path, body } = tool.dispatch(args ?? {});
    const req = new Request(`https://mcp.internal${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const res = await app.fetch(req, c.env, c.executionCtx);
    if (res.status === 204) return toolContent('Deleted.');

    const raw = await res.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      /* keep raw text */
    }

    if (!res.ok) {
      const detail = typeof parsed === 'object' && parsed ? parsed : { body: parsed };
      return toolContent(JSON.stringify({ status: res.status, ...detail }, null, 2), true);
    }
    return toolContent(JSON.stringify(parsed, null, 2));
  }

  async function handle(msg: JsonRpcMessage) {
    const id = msg.id ?? null;
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params?.protocolVersion;
        const protocolVersion =
          typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
            ? requested
            : DEFAULT_PROTOCOL_VERSION;
        return ok(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: availableTools(config).map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      case 'tools/call': {
        const name = msg.params?.name;
        if (typeof name !== 'string') return fail(id, -32602, 'Invalid params: name is required');
        const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
        return ok(id, await dispatchTool(name, args));
      }
      default:
        return fail(id, -32601, `Method not found: ${msg.method ?? ''}`);
    }
  }

  const responses = [];
  for (const msg of messages) {
    // Notifications (no id, e.g. notifications/initialized) get no JSON-RPC response.
    if (msg.id === undefined || msg.id === null) continue;
    responses.push(await handle(msg));
  }

  if (responses.length === 0) {
    return c.body(null, 202);
  }
  return c.json(Array.isArray(payload) ? responses : responses[0]);
}
