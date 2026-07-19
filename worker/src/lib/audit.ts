import type { Actor } from '../types';

export interface AuditEntry {
  actionType: 'INSERT' | 'UPDATE' | 'DELETE';
  taskId: string;
  fieldChanged?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
}

/**
 * Builds an audit_trail insert statement (spec §8.3). Returned as a
 * D1PreparedStatement so callers can include it in the same db.batch() as
 * the mutation it records, keeping both writes atomic.
 */
export function auditStatement(db: D1Database, actor: Actor | null, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_trail (id, actor_id, actor_scope, action_type, task_id, field_changed, old_value, new_value)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      crypto.randomUUID(),
      actor?.id ?? null,
      actor?.scope ?? null,
      entry.actionType,
      entry.taskId,
      entry.fieldChanged ?? null,
      entry.oldValue ?? null,
      entry.newValue ?? null
    );
}
