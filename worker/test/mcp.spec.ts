import { SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authed, bootstrapAdmin, issueToken } from './helpers';

async function setMcp(adminToken: string, patch: Record<string, unknown>) {
  return SELF.fetch('https://test/api/admin/mcp', authed(adminToken, { method: 'PATCH', body: JSON.stringify(patch) }));
}

async function rpc(token: string | null, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch('https://test/api/mcp', { method: 'POST', body: JSON.stringify(body), headers });
}

interface ToolResult {
  result: { content: Array<{ type: string; text: string }>; isError?: boolean };
}

function toolPayload(res: ToolResult) {
  return JSON.parse(res.result.content[0]!.text);
}

describe('MCP server (/api/mcp)', () => {
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    adminToken = await bootstrapAdmin();
    userToken = await issueToken(adminToken, 'human');
  });

  it('is disabled by default and returns 503', async () => {
    const res = await rpc(userToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(503);
  });

  it('exposes config to admins and lets them toggle it', async () => {
    const before = await SELF.fetch('https://test/api/admin/mcp', authed(adminToken)).then((r) =>
      r.json<{ mcp: { enabled: boolean; write_enabled: boolean } }>()
    );
    expect(before.mcp).toEqual({ enabled: false, write_enabled: true });

    const after = await setMcp(adminToken, { enabled: true }).then((r) =>
      r.json<{ mcp: { enabled: boolean } }>()
    );
    expect(after.mcp.enabled).toBe(true);
  });

  it('rejects the config endpoint for non-admins', async () => {
    const res = await SELF.fetch('https://test/api/admin/mcp', authed(userToken));
    expect(res.status).toBe(403);
  });

  describe('when enabled', () => {
    beforeEach(async () => {
      await setMcp(adminToken, { enabled: true, write_enabled: true });
    });

    it('rejects an unauthenticated caller', async () => {
      const res = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect(res.status).toBe(401);
    });

    it('handles initialize and returns no body for the initialized notification', async () => {
      const init = await rpc(userToken, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }).then((r) => r.json<{ result: { protocolVersion: string; serverInfo: { name: string } } }>());
      expect(init.result.protocolVersion).toBe('2025-06-18');
      expect(init.result.serverInfo.name).toBe('task-manager-mcp');

      const note = await rpc(userToken, { jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(note.status).toBe(202);
    });

    it('lists all nine tools including writes', async () => {
      const res = await rpc(userToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).then((r) =>
        r.json<{ result: { tools: Array<{ name: string }> } }>()
      );
      const names = res.result.tools.map((t) => t.name);
      expect(names).toContain('actionable');
      expect(names).toContain('create_task');
      expect(res.result.tools).toHaveLength(9);
    });

    it('runs a read tool', async () => {
      const res = await rpc(userToken, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'actionable', arguments: {} },
      }).then((r) => r.json<ToolResult>());
      expect(res.result.isError).toBeFalsy();
      expect(toolPayload(res)).toHaveProperty('tasks');
    });

    it('creates and updates a task through tools, preserving OCC', async () => {
      const created = await rpc(userToken, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { title: 'Via MCP' } },
      })
        .then((r) => r.json<ToolResult>())
        .then(toolPayload);
      expect(created.title).toBe('Via MCP');
      expect(created.version).toBe(1);

      const updated = await rpc(userToken, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'update_task', arguments: { id: created.id, version: 1, status: 'in_progress' } },
      })
        .then((r) => r.json<ToolResult>())
        .then(toolPayload);
      expect(updated.status).toBe('in_progress');
      expect(updated.version).toBe(2);

      const conflict = await rpc(userToken, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'update_task', arguments: { id: created.id, version: 1, status: 'done' } },
      }).then((r) => r.json<ToolResult>());
      expect(conflict.result.isError).toBe(true);
      expect(toolPayload(conflict).status).toBe(409);
    });
  });

  describe('when write access is disabled', () => {
    beforeEach(async () => {
      await setMcp(adminToken, { enabled: true, write_enabled: false });
    });

    it('hides write tools from the list', async () => {
      const res = await rpc(userToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).then((r) =>
        r.json<{ result: { tools: Array<{ name: string }> } }>()
      );
      const names = res.result.tools.map((t) => t.name);
      expect(names).toContain('actionable');
      expect(names).not.toContain('create_task');
    });

    it('rejects calls to write tools', async () => {
      const res = await rpc(userToken, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { title: 'nope' } },
      }).then((r) => r.json<ToolResult>());
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0]!.text).toContain('disabled');
    });
  });
});
