import type { ApiToken, TaskDetailEntity, TaskEntity, TokenScope } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export interface TaskFilters {
  status?: string;
  assignee?: string;
  category?: string;
}

export const api = {
  setup: (setupToken: string, name?: string) =>
    request<{ id: string; name: string; scope: TokenScope; token: string }>('/api/setup', setupToken, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  listTasks: (token: string, filters: TaskFilters = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const qs = params.toString();
    return request<{ tasks: TaskEntity[] }>(`/api/tasks${qs ? `?${qs}` : ''}`, token);
  },

  getTask: (token: string, id: string) => request<TaskDetailEntity>(`/api/tasks/${id}`, token),

  createTask: (token: string, body: Record<string, unknown>) =>
    request<TaskDetailEntity>('/api/tasks', token, { method: 'POST', body: JSON.stringify(body) }),

  patchTask: (token: string, id: string, body: Record<string, unknown>) =>
    request<TaskDetailEntity>(`/api/tasks/${id}`, token, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteTask: (token: string, id: string) => request<void>(`/api/tasks/${id}`, token, { method: 'DELETE' }),

  logTime: (token: string, id: string, body: { duration: number; notes?: string }) =>
    request<TaskDetailEntity>(`/api/tasks/${id}/time-logs`, token, { method: 'POST', body: JSON.stringify(body) }),

  agentActionable: (token: string) => request<{ tasks: Array<{ id: string }> }>('/api/agent/actionable', token),

  listTokens: (token: string) => request<{ tokens: ApiToken[] }>('/api/admin/tokens', token),

  issueToken: (token: string, body: { name: string; scope: TokenScope; expires_at?: string | null }) =>
    request<ApiToken & { token: string }>('/api/admin/tokens', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  rotateToken: (token: string, id: string) =>
    request<ApiToken & { token: string }>(`/api/admin/tokens/${id}/rotate`, token, { method: 'POST' }),

  revokeToken: (token: string, id: string) => request<ApiToken>(`/api/admin/tokens/${id}`, token, { method: 'DELETE' }),
};

export function eventsUrl(token: string): string {
  return `${BASE_URL}/api/events?token=${encodeURIComponent(token)}`;
}
