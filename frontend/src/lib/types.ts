export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';
export type TokenScope = 'admin' | 'human' | 'agent';

export const STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'blocked', 'done'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};

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

export interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  scope: TokenScope;
  created_by: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
