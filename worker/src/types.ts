export type TokenScope = 'admin' | 'human' | 'agent';

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';

export interface RateLimitOutcome {
  success: boolean;
}

export interface RateLimit {
  limit(options: { key: string }): Promise<RateLimitOutcome>;
}

export interface Env {
  DB: D1Database;
  REALTIME_HUB: DurableObjectNamespace;
  AGENT_RATE_LIMITER: RateLimit;
  SETUP_TOKEN: string;
  ALLOWED_ORIGIN?: string;
}

export interface Actor {
  id: string;
  scope: TokenScope;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  category: string;
  assignee: string | null;
  estimated_time: number;
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TaskLink {
  url: string;
  label: string;
}

export interface TimeLogEntity {
  id: string;
  duration: number;
  notes: string | null;
  logged_at: string;
}

export interface TaskEntity {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  due_date: string | null;
  category: string;
  assignee: string | null;
  tags: string[];
  links: TaskLink[];
  dependencies: string[];
  estimated_time: number;
  actual_time: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TaskDetailEntity extends TaskEntity {
  time_logs: TimeLogEntity[];
}
