import type { Env } from '../types';

function getHubStub(env: Env) {
  const id = env.REALTIME_HUB.idFromName('global');
  return env.REALTIME_HUB.get(id);
}

export type TaskEventType = 'task.created' | 'task.updated' | 'task.deleted';

export async function publishTaskEvent(
  env: Env,
  type: TaskEventType,
  task: unknown
): Promise<void> {
  const stub = getHubStub(env);
  await stub.fetch('https://realtime-hub/broadcast', {
    method: 'POST',
    body: JSON.stringify({ type, task }),
  });
}

export function subscribeToHub(env: Env): Promise<Response> {
  const stub = getHubStub(env);
  return stub.fetch('https://realtime-hub/subscribe');
}
