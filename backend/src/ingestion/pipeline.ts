import type Database from "better-sqlite3";
import type { JobSourceAdapter } from "../adapters/types.js";
import type { NewJob } from "../types/job.js";

export interface IngestionSummary {
  source: string;
  fetched: number;
  inserted: number;
}

// `first_seen_at` is only ever set by the SQL default (`datetime('now')`) on
// the INSERT branch. The ON CONFLICT UPDATE clause intentionally omits it,
// so a re-ingested job keeps the timestamp from when it was first seen.
const UPSERT_SQL = `
  INSERT INTO jobs (
    id, source, external_id, title, company, location, remote, url,
    description, tags, posted_at, first_seen_at
  ) VALUES (
    @id, @source, @externalId, @title, @company, @location, @remote, @url,
    @description, @tags, @postedAt, datetime('now')
  )
  ON CONFLICT(source, external_id) DO UPDATE SET
    title = excluded.title,
    company = excluded.company,
    location = excluded.location,
    remote = excluded.remote,
    url = excluded.url,
    description = excluded.description,
    tags = excluded.tags,
    posted_at = excluded.posted_at
`;

/**
 * Fetches jobs from every adapter in parallel and upserts them into the
 * `jobs` table. A single adapter throwing/rejecting never aborts the whole
 * run — it's logged and reported with fetched=0/inserted=0 in the summary.
 */
export async function runIngestion(
  db: Database.Database,
  adapters: JobSourceAdapter[]
): Promise<IngestionSummary[]> {
  const existsStmt = db.prepare("SELECT 1 FROM jobs WHERE source = ? AND external_id = ?");
  const upsertStmt = db.prepare(UPSERT_SQL);

  const settled = await Promise.allSettled(
    adapters.map(async (adapter): Promise<IngestionSummary> => {
      const fetched: NewJob[] = await adapter.fetchJobs();

      let inserted = 0;
      const upsertAll = db.transaction((newJobs: NewJob[]) => {
        for (const job of newJobs) {
          const alreadyExists = existsStmt.get(job.source, job.externalId);
          if (!alreadyExists) inserted += 1;
          upsertStmt.run({
            id: `${job.source}:${job.externalId}`,
            source: job.source,
            externalId: job.externalId,
            title: job.title,
            company: job.company,
            location: job.location,
            remote: job.remote ? 1 : 0,
            url: job.url,
            description: job.description,
            tags: JSON.stringify(job.tags ?? []),
            postedAt: job.postedAt,
          });
        }
      });
      upsertAll(fetched);

      return { source: adapter.source, fetched: fetched.length, inserted };
    })
  );

  return settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    console.error(`[ingestion] adapter "${adapters[i].source}" failed:`, result.reason);
    return { source: adapters[i].source, fetched: 0, inserted: 0 };
  });
}
