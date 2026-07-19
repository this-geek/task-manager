import type { TaskEntity } from '../lib/types';
import { dueBadge, formatMinutes } from '../lib/dates';

interface Props {
  task: TaskEntity;
  onOpen: (id: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, task: TaskEntity) => void;
}

export function TaskCard({ task, onOpen, draggable, onDragStart }: Props) {
  const badge = dueBadge(task.due_date);

  return (
    <button
      type="button"
      className="task-card"
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, task)}
      onClick={() => onOpen(task.id)}
    >
      <span className="title">{task.title}</span>
      <span className="meta-row">
        <span className="pill">{task.category}</span>
        {task.assignee && <span className="pill">{task.assignee}</span>}
        {badge && <span className={badge.className}>{badge.label}</span>}
        {task.dependencies.length > 0 && <span className="pill">{task.dependencies.length} dep</span>}
        {task.estimated_time > 0 && <span className="pill">{formatMinutes(task.estimated_time)}</span>}
      </span>
      {task.tags.length > 0 && (
        <span className="tags">
          {task.tags.map((tag) => (
            <span key={tag} className="pill">
              #{tag}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
