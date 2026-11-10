import type { Db } from "./index.js";

/** app_state key set once every old description has left `jobs`. */
const DONE_KEY = "descriptions_moved";

/**
 * Moves descriptions stored in `jobs` (before job_descriptions existed) into
 * job_descriptions, `batchSize` rows at a time, starting after `afterRowid`.
 * Each batch is one short transaction, so the freed space is reused by the
 * next batch's inserts and the file barely grows.
 */
export function moveDescriptionsBatch(db: Db, afterRowid: number, batchSize: number): { moved: number; lastRowid: number; done: boolean } {
  const rows = db
    .prepare("SELECT rowid AS rid, id, description FROM jobs WHERE rowid > ? AND description IS NOT NULL ORDER BY rowid LIMIT ?")
    .all(afterRowid, batchSize) as { rid: number; id: string; description: string }[];
  if (rows.length > 0) {
    // A description written since (ingestion) is newer: keep it.
    const insert = db.prepare("INSERT INTO job_descriptions (job_id, description) VALUES (?, ?) ON CONFLICT(job_id) DO NOTHING");
    const clear = db.prepare("UPDATE jobs SET description = NULL WHERE rowid = ?");
    db.transaction(() => {
      for (const row of rows) {
        insert.run(row.id, row.description);
        clear.run(row.rid);
      }
    })();
  }
  return { moved: rows.length, lastRowid: rows.at(-1)?.rid ?? afterRowid, done: rows.length < batchSize };
}

export function descriptionsMoved(db: Db): boolean {
  return db.prepare("SELECT 1 FROM app_state WHERE key = ?").get(DONE_KEY) !== undefined;
}

/**
 * Empties `jobs.description` in the background, pausing between batches so
 * the API keeps answering. Runs once per database: when it finishes, it
 * records that in app_state and later starts return immediately.
 */
export async function moveDescriptions(
  db: Db,
  { batchSize = 500, pauseMs = 100, log = console.log }: { batchSize?: number; pauseMs?: number; log?: (message: string) => void } = {},
): Promise<number> {
  if (descriptionsMoved(db)) return 0;
  let total = 0;
  let after = 0;
  for (;;) {
    const batch = moveDescriptionsBatch(db, after, batchSize);
    total += batch.moved;
    after = batch.lastRowid;
    if (batch.done) break;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    DONE_KEY,
    new Date().toISOString(),
  );
  log(`[db] moved ${total} descriptions to job_descriptions`);
  return total;
}
