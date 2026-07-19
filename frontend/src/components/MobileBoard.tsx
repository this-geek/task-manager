import { STATUSES, STATUS_LABELS, type TaskEntity, type TaskStatus } from '../lib/types';
import { TaskCard } from './TaskCard';

interface Props {
  tasks: TaskEntity[];
  activeStatus: TaskStatus;
  onChangeStatus: (status: TaskStatus) => void;
  onOpen: (id: string) => void;
}

export function MobileBoard({ tasks, activeStatus, onChangeStatus, onOpen }: Props) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length])) as Record<
    TaskStatus,
    number
  >;
  const visible = tasks.filter((t) => t.status === activeStatus);

  return (
    <>
      <div className="segmented-control">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={status === activeStatus ? 'active' : ''}
            onClick={() => onChangeStatus(status)}
          >
            {STATUS_LABELS[status]} ({counts[status]})
          </button>
        ))}
      </div>
      <div className="mobile-task-list">
        {visible.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpen} />
        ))}
        {visible.length === 0 && <p className="empty-state">No tasks in {STATUS_LABELS[activeStatus]}.</p>}
      </div>
    </>
  );
}
