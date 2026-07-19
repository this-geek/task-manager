/** Finds or creates each tag by name, returning their tag ids. */
export async function upsertTagIds(db: D1Database, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    let row = await db.prepare('SELECT id FROM tags WHERE name = ?1').bind(name).first<{ id: string }>();
    if (!row) {
      const id = crypto.randomUUID();
      try {
        await db.prepare('INSERT INTO tags (id, name) VALUES (?1, ?2)').bind(id, name).run();
        row = { id };
      } catch {
        // Lost a race with a concurrent insert of the same tag name; re-select.
        row = await db.prepare('SELECT id FROM tags WHERE name = ?1').bind(name).first<{ id: string }>();
      }
    }
    if (row) ids.push(row.id);
  }

  return ids;
}
