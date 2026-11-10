import fs from "node:fs";
import path from "node:path";
import type { Db } from "./index.js";

/** app_state key set once every old description has left `jobs`. */
const DONE_KEY = "descriptions_moved";
/** app_state key set once the database was compacted after the move. */
const COMPACTED_KEY = "compacted_after_description_move";

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
  { batchSize = 200, pauseMs = 500, log = console.log }: { batchSize?: number; pauseMs?: number; log?: (message: string) => void } = {},
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

/**
 * Once, after the move: rewrites the database compactly (VACUUM). The move
 * leaves `jobs` pages mostly empty, so scans still read ~3x the pages they
 * need until this runs. VACUUM blocks the process (minutes on a large
 * database) and, in WAL mode, needs about the database's size free on its
 * disk, so it only runs when that space is there; otherwise it logs why and
 * tries again on the next start.
 */
export function compactOnce(
  db: Db,
  dbPath: string,
  { log = console.log, freeBytes = defaultFreeBytes }: { log?: (message: string) => void; freeBytes?: (dir: string) => number } = {},
): boolean {
  if (dbPath === ":memory:" || !descriptionsMoved(db)) return false;
  if (db.prepare("SELECT 1 FROM app_state WHERE key = ?").get(COMPACTED_KEY)) return false;
  // A WAL left large (e.g. by a VACUUM killed mid-way) would eat the space it needs.
  db.pragma("wal_checkpoint(TRUNCATE)");
  const size = fs.statSync(dbPath).size;
  const free = freeBytes(path.dirname(dbPath));
  // The rewrite goes through the WAL first: up to the database's size, plus a margin.
  const needed = size + 64 * 1024 * 1024;
  if (free < needed) {
    log(`[db] not compacting: ${mb(free)} free, needs ${mb(needed)}; will retry on the next start`);
    return false;
  }
  log(`[db] compacting ${mb(size)} (the API pauses until it finishes)…`);
  const started = Date.now();
  db.exec("VACUUM");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    COMPACTED_KEY,
    new Date().toISOString(),
  );
  log(`[db] compacted ${mb(size)} -> ${mb(fs.statSync(dbPath).size)} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return true;
}

function defaultFreeBytes(dir: string): number {
  const stats = fs.statfsSync(dir);
  return stats.bavail * stats.bsize;
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}
