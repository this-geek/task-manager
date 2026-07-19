import { useState } from 'react';
import { STATUSES, STATUS_LABELS, type TaskEntity, type TaskStatus } from '../lib/types';
import { TaskCard } from './TaskCard';

interface Props {
  tasks: TaskEntity[];
  onOpen: (id: string) => void;
  onMove: (task: TaskEntity, status: TaskStatus) => void;
}

export function KanbanBoard({ tasks, onOpen, onMove }: Props) {
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

  return (
    <div className="kanban-columns">
      {STATUSES.map((status) => {
        const columnTasks = tasks.filter((t) => t.status === status);
        return (
          <div
            key={status}
            className={`kanban-column${dragOverStatus === status ? ' drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStatus(status);
            }}
            onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStatus(null);
              const taskId = e.dataTransfer.getData('text/task-id');
              const task = tasks.find((t) => t.id === taskId);
              if (task && task.status !== status) onMove(task, status);
            }}
          >
            <div className="kanban-column-header">
              <span className={`dot status-dot-${status}`} />
              <span>{STATUS_LABELS[status]}</span>
              <span className="count">{columnTasks.length}</span>
            </div>
            <div className="kanban-column-body">
              {columnTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onOpen={onOpen}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/task-id', task.id)}
                />
              ))}
              {columnTasks.length === 0 && <p className="hint">No tasks</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
