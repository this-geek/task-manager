interface DependencyEdge {
  task_id: string;
  blocked_by_task_id: string;
}

/**
 * Circular-dependency guard (spec §7.1, in-memory variant). PATCH replaces a
 * task's entire dependency set in one call, so edges within the same request
 * must be checked against each other too, not just against what's already
 * committed — a single CTE query per edge would miss that. Loads the whole
 * task_dependencies table (small graph for this app's scale) and walks it
 * in memory instead.
 *
 * Returns the first blocked-by id that would close a loop, or null if the
 * full replacement set is safe.
 */
export async function findCyclicDependency(
  db: D1Database,
  taskId: string,
  newBlockedByIds: string[]
): Promise<string | null> {
  const { results } = await db
    .prepare('SELECT task_id, blocked_by_task_id FROM task_dependencies')
    .all<DependencyEdge>();

  const graph = new Map<string, Set<string>>();
  for (const edge of results) {
    if (edge.task_id === taskId) continue; // this task's old edges are being replaced
    if (!graph.has(edge.task_id)) graph.set(edge.task_id, new Set());
    graph.get(edge.task_id)!.add(edge.blocked_by_task_id);
  }

  const mine = new Set<string>();
  graph.set(taskId, mine);

  function reaches(from: string, target: string, seen: Set<string>): boolean {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of graph.get(from) ?? []) {
      if (reaches(next, target, seen)) return true;
    }
    return false;
  }

  for (const blockedBy of newBlockedByIds) {
    if (blockedBy === taskId || reaches(blockedBy, taskId, new Set())) {
      return blockedBy;
    }
    mine.add(blockedBy);
  }

  return null;
}
