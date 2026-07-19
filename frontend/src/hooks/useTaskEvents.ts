import { useEffect, useRef } from 'react';
import { eventsUrl } from '../lib/api';
import type { TaskEntity } from '../lib/types';

type TaskEventType = 'task.created' | 'task.updated' | 'task.deleted';

interface TaskEventPayload {
  type: TaskEventType;
  task: TaskEntity | { id: string };
}

/** Subscribes to the SSE feed (spec §8.2) and invokes the callback for each task event. */
export function useTaskEvents(token: string | null, onEvent: (payload: TaskEventPayload) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!token) return;

    const source = new EventSource(eventsUrl(token));
    source.onmessage = (event) => {
      try {
        onEventRef.current(JSON.parse(event.data) as TaskEventPayload);
      } catch {
        // ignore malformed frames
      }
    };

    return () => source.close();
  }, [token]);
}
