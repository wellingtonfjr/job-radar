import { CLOSED_VERDICTS_TO_CLOSE } from "../accuracy/verify.js";
import type { Db } from "../db/index.js";
import type { NormalizedJob } from "../domain/job.js";
import { companyKey, isOpening, normalizeJob } from "../normalize/index.js";
import { toSearchKey } from "../normalize/text.js";
import { errorMessage } from "../sources/http.js";
import type { FeedError, SourceAdapter } from "../sources/types.js";

export interface SourceRunSummary {
  source: string;
  status: "ok" | "partial" | "error" | "skipped";
  fetched: number;
  inserted: number;
  closed: number;
  errors: FeedError[];
}

export interface IngestionOptions {
  /** Ignore each source's minimum interval. */
  force?: boolean;
  /** Global minimum minutes between runs of any source (e.g. 12h). */
  minIntervalMinutes?: number;
  now?: () => Date;
  /** Days without being seen before a role from a partially read feed is retired. */
  staleAfterDays: number | StaleWindows;
}

const SOURCE_RANK = { ats: 0, aggregator: 1 } as const;

const DROP_GUARD_RATIO = 0.5;
const MIN_FEED_FOR_DROP_GUARD = 10;

// `first_seen_at` is only written on INSERT; re-seeing a job refreshes
// everything else, bumps `last_seen_at` and re-opens it if it was closed,
// unless the liveness check closed it: a job board can keep listing a role
// whose ATS posting is gone.
const UPSERT_SQL = `
  INSERT INTO jobs (
    id, source, feed, external_id, title, company, company_key, company_logo, url, locations,
    workplace, allowed_countries, category, seniority, employment_type, salary_min, salary_max,
    salary_currency, salary_period, salary_min_usd_year, skills, tags, description, description_links, search_text,
    posted_at, expires_at, fingerprint, source_rank, first_seen_at, last_seen_at, closed_at
  ) VALUES (
    @id, @source, @feed, @externalId, @title, @company, @companyKey, @companyLogo, @url, @locations,
    @workplace, @allowedCountries, @category, @seniority, @employmentType, @salaryMin, @salaryMax,
    @salaryCurrency, @salaryPeriod, @salaryMinUsdYear, @skills, @tags, @description, @descriptionLinks, @searchText,
    @postedAt, @expiresAt, @fingerprint, @sourceRank, @seenAt, @seenAt, NULL
  )
  ON CONFLICT(source, external_id) DO UPDATE SET
    feed = excluded.feed,
    title = excluded.title,
    company = excluded.company,
    company_key = excluded.company_key,
    company_logo = excluded.company_logo,
    url = excluded.url,
    locations = excluded.locations,
    workplace = excluded.workplace,
    allowed_countries = excluded.allowed_countries,
    category = excluded.category,
    seniority = excluded.seniority,
    employment_type = excluded.employment_type,
    salary_min = excluded.salary_min,
    salary_max = excluded.salary_max,
    salary_currency = excluded.salary_currency,
    salary_period = excluded.salary_period,
    salary_min_usd_year = excluded.salary_min_usd_year,
    skills = excluded.skills,
    tags = excluded.tags,
    description = excluded.description,
    description_links = excluded.description_links,
    search_text = excluded.search_text,
    posted_at = COALESCE(excluded.posted_at, jobs.posted_at),
    expires_at = excluded.expires_at,
    fingerprint = excluded.fingerprint,
    source_rank = excluded.source_rank,
    last_seen_at = excluded.last_seen_at,
    closed_at = CASE WHEN jobs.closed_streak >= ${CLOSED_VERDICTS_TO_CLOSE} THEN jobs.closed_at ELSE NULL END
`;

function toRow(job: NormalizedJob, sourceRank: number, seenAt: string): Record<string, unknown> {
  return {
    id: job.id,
    source: job.source,
    feed: job.feed,
    externalId: job.externalId,
    title: job.title,
    company: job.company,
    companyKey: companyKey(job.company),
    companyLogo: job.companyLogo,
    url: job.url,
    locations: JSON.stringify(job.locations),
    workplace: job.workplace,
    allowedCountries: job.allowedCountries ? JSON.stringify(job.allowedCountries) : null,
    category: job.category,
    seniority: job.seniority,
    employmentType: job.employmentType,
    salaryMin: job.salary?.min ?? null,
    salaryMax: job.salary?.max ?? null,
    salaryCurrency: job.salary?.currency ?? null,
    salaryPeriod: job.salary?.period ?? null,
    salaryMinUsdYear: job.salaryMinUsdYear,
    skills: JSON.stringify(job.skills),
    tags: JSON.stringify(job.tags),
    description: job.description,
    descriptionLinks: JSON.stringify(job.descriptionLinks),
    searchText: toSearchKey([job.title, job.company, ...job.skills, ...job.tags].join(" ")),
    postedAt: job.postedAt,
    expiresAt: job.expiresAt,
    fingerprint: job.fingerprint,
    sourceRank,
    seenAt,
  };
}

function isDue(db: Db, source: SourceAdapter, now: Date, floorMinutes = 0): boolean {
  const last = db
    .prepare("SELECT started_at FROM source_runs WHERE source = ? AND status != 'error' ORDER BY started_at DESC LIMIT 1")
    .get(source.id) as { started_at: string } | undefined;
  if (!last) return true;
  const interval = Math.max(source.minIntervalMinutes, floorMinutes);
  return now.getTime() - Date.parse(last.started_at) >= interval * 60_000;
}

/** Fetches one source and writes its results. Never throws. */
export async function ingestSource(db: Db, source: SourceAdapter, now: Date): Promise<SourceRunSummary> {
  const startedAt = now.toISOString();
  const runId = db.prepare("INSERT INTO source_runs (source, started_at) VALUES (?, ?)").run(source.id, startedAt)
    .lastInsertRowid;

  const summary: SourceRunSummary = { source: source.id, status: "ok", fetched: 0, inserted: 0, closed: 0, errors: [] };
  try {
    const storedDescription = db.prepare("SELECT description FROM jobs WHERE source = ? AND external_id = ?");
    const outcome = await source.fetchJobs({
      storedDescription: (externalId) =>
        (storedDescription.get(source.id, externalId) as { description: string | null } | undefined)?.description ?? null,
    });
    summary.errors = outcome.errors;

    const exists = db.prepare("SELECT 1 FROM jobs WHERE id = ?");
    const upsert = db.prepare(UPSERT_SQL);
    const openInFeed = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE source = ? AND feed = ? AND closed_at IS NULL");
    // Anything in a complete feed that this run didn't touch is gone upstream.
    const closeMissing = db.prepare(
      "UPDATE jobs SET closed_at = @now WHERE source = @source AND feed = @feed AND closed_at IS NULL AND last_seen_at < @seenAt",
    );

    for (const result of outcome.results) {
      const seen = new Map<string, NormalizedJob>();
      for (const raw of result.jobs) {
        try {
          const job = normalizeJob(source.id, result.feed, raw);
          if (!job.url) {
            // Not a web address (or a script/data URL): never stored, but
            // reported so a source sending bad links doesn't go unnoticed.
            summary.errors.push({ feed: result.feed, error: `rejected unsafe or invalid URL for ${raw.externalId}` });
            continue;
          }
          // Résumé pools are skipped (and closed, if stored before).
          if (job.title && isOpening(job.title)) seen.set(job.id, job);
        } catch (err) {
          summary.errors.push({ feed: result.feed, error: `normalize ${raw.externalId}: ${errorMessage(err)}` });
        }
      }

      db.transaction(() => {
        for (const job of seen.values()) {
          if (!exists.get(job.id)) summary.inserted += 1;
          upsert.run(toRow(job, SOURCE_RANK[source.kind], startedAt));
        }
        if (result.complete) {
          // Guard against partial responses: a "complete" board that suddenly
          // lists under half of what was open is more likely an upstream
          // glitch than mass hiring, so nothing is closed this run. Jobs the
          // adapter filtered out on purpose still count as listed.
          const open = (openInFeed.get(source.id, result.feed) as { n: number }).n;
          const listed = seen.size + (result.skipped ?? 0);
          if (open >= MIN_FEED_FOR_DROP_GUARD && listed < open * DROP_GUARD_RATIO) {
            summary.errors.push({ feed: result.feed, error: `listed ${listed} of ${open} open jobs; not closing any this run` });
          } else {
            summary.closed += closeMissing.run({ now: startedAt, source: source.id, feed: result.feed, seenAt: startedAt }).changes;
          }
        }
      })();
      summary.fetched += seen.size;
    }

    if (source.feeds && outcome.results.length > 0) {
      const placeholders = source.feeds.map(() => "?").join(", ") || "NULL";
      summary.closed += db
        .prepare(`UPDATE jobs SET closed_at = ? WHERE source = ? AND closed_at IS NULL AND feed NOT IN (${placeholders})`)
        .run(startedAt, source.id, ...source.feeds).changes;
    }

    if (summary.errors.length > 0) summary.status = outcome.results.length > 0 ? "partial" : "error";
  } catch (err) {
    summary.status = "error";
    summary.errors.push({ feed: "*", error: errorMessage(err) });
  }

  db.prepare(
    "UPDATE source_runs SET finished_at = ?, status = ?, fetched = ?, inserted = ?, closed = ?, errors = ? WHERE id = ?",
  ).run(
    new Date().toISOString(),
    summary.status,
    summary.fetched,
    summary.inserted,
    summary.closed,
    JSON.stringify(summary.errors.slice(0, 50)),
    runId,
  );
  return summary;
}

/**
 * How long a role from a partially read feed stays open without being seen
 * again: `bySource[source]` days, else `defaultDays`.
 */
export interface StaleWindows {
  defaultDays: number;
  bySource?: Readonly<Record<string, number>>;
}

/**
 * Job boards get `jobBoardDays`: most of their roles can't be checked against
 * the employer, so absence from the feed is the only signal. Every other
 * source gets `defaultDays`.
 */
export function staleWindowsFor(sources: readonly SourceAdapter[], defaultDays: number, jobBoardDays: number): StaleWindows {
  return { defaultDays, bySource: Object.fromEntries(sources.filter((s) => s.kind === "aggregator").map((s) => [s.id, jobBoardDays])) };
}

/**
 * Retires jobs we can no longer vouch for: past their source-given expiry,
 * or (for feeds that are only partially read) not seen for their source's
 * stale window. Roles the liveness check verifies keep at least the default
 * window, since it closes them as soon as their ATS posting goes. Résumé
 * pools stored before they were filtered out are retired too (they may sit
 * in a partially-read feed where absence never closes them).
 */
export function retireStaleJobs(db: Db, now: Date, stale: number | StaleWindows): number {
  const { defaultDays, bySource = {} } = typeof stale === "number" ? { defaultDays: stale } : stale;
  const nowIso = now.toISOString();
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  let retired = db
    .prepare("UPDATE jobs SET closed_at = ? WHERE closed_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?")
    .run(nowIso, nowIso).changes;
  const staleInSource = db.prepare(
    `UPDATE jobs SET closed_at = @now
     WHERE closed_at IS NULL AND source = @source AND last_seen_at < @staleBefore
       AND (last_verified_at IS NULL OR last_seen_at < @verifiedStaleBefore)`,
  );
  for (const [source, days] of Object.entries(bySource)) {
    retired += staleInSource.run({ now: nowIso, source, staleBefore: before(days), verifiedStaleBefore: before(Math.max(days, defaultDays)) }).changes;
  }
  const others = Object.keys(bySource);
  const notOthers = others.length > 0 ? `AND source NOT IN (${others.map(() => "?").join(", ")})` : "";
  retired += db
    .prepare(`UPDATE jobs SET closed_at = ? WHERE closed_at IS NULL AND last_seen_at < ? ${notOthers}`)
    .run(nowIso, before(defaultDays), ...others).changes;

  const update = db.prepare("UPDATE jobs SET closed_at = ? WHERE id = ?");
  const pools = (db.prepare("SELECT id, title FROM jobs WHERE closed_at IS NULL").all() as { id: string; title: string }[]).filter(
    (j) => !isOpening(j.title),
  );
  db.transaction(() => pools.forEach((j) => update.run(nowIso, j.id)))();
  return retired + pools.length;
}

/**
 * ATS postings older than this are evergreen "talent pools" (some Lever
 * boards keep the same posting open for years), not current openings.
 */
export const EVERGREEN_AFTER_DAYS = 180;

/**
 * Decides which open jobs the default listing shows (`canonical = 1`); the
 * listing, its counts, /api/stats, the sitemap and RSS all filter on it.
 *
 * - Cross-source copies of the same opening are hidden: a job is
 *   non-canonical when another *source* has it open with a better rank (the
 *   employer's own ATS beats aggregators). Same-source matches are left
 *   alone — one company posting "Account Executive" in five cities is five
 *   real openings.
 * - Evergreen ATS postings (posted over EVERGREEN_AFTER_DAYS ago) are hidden.
 *   They stay open and still hide their aggregator copies, so the same pool
 *   doesn't resurface through a job board; the `source` filter still shows them.
 *   Aggregators are left alone: their feeds only carry recent postings.
 */
export function recomputeCanonical(db: Db, now: Date): void {
  const evergreenBefore = new Date(now.getTime() - EVERGREEN_AFTER_DAYS * 86_400_000).toISOString();
  db.prepare(
    `UPDATE jobs SET canonical = closed_at IS NULL
      AND NOT (source_rank = @atsRank AND COALESCE(posted_at, first_seen_at) < @evergreenBefore)
      AND NOT EXISTS (
        SELECT 1 FROM jobs o
        WHERE o.fingerprint = jobs.fingerprint
          AND o.source != jobs.source
          AND o.closed_at IS NULL
          AND (o.source_rank < jobs.source_rank OR (o.source_rank = jobs.source_rank AND o.source < jobs.source))
      )`,
  ).run({ atsRank: SOURCE_RANK.ats, evergreenBefore });
}

const TIER_THRESHOLDS: [string, number][] = [
  ["S", 120_000],
  ["A", 90_000],
  ["B", 50_000],
];
const MIN_TIER_SAMPLES = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Pay tier per company from the salaries it actually publishes. Senior-level
 * postings are used when there are enough of them (tiers describe senior
 * pay); otherwise every posting with a salary.
 */
export function recomputeCompanyTiers(db: Db): void {
  const rows = db
    .prepare(
      `SELECT company_key, seniority, salary_min_usd_year AS usd FROM jobs
       WHERE closed_at IS NULL AND salary_min_usd_year IS NOT NULL AND salary_period = 'year'`,
    )
    .all() as { company_key: string; seniority: string | null; usd: number }[];

  const byCompany = new Map<string, { senior: number[]; all: number[] }>();
  for (const row of rows) {
    const entry = byCompany.get(row.company_key) ?? { senior: [], all: [] };
    entry.all.push(row.usd);
    if (row.seniority === "senior" || row.seniority === "lead") entry.senior.push(row.usd);
    byCompany.set(row.company_key, entry);
  }

  const upsert = db.prepare(
    `INSERT INTO companies (company_key, tier, median_salary_usd, salary_samples) VALUES (?, ?, ?, ?)
     ON CONFLICT(company_key) DO UPDATE SET tier = excluded.tier, median_salary_usd = excluded.median_salary_usd,
       salary_samples = excluded.salary_samples`,
  );
  db.transaction(() => {
    db.exec("DELETE FROM companies");
    for (const [key, { senior, all }] of byCompany) {
      const sample = senior.length >= MIN_TIER_SAMPLES ? senior : all;
      if (sample.length < MIN_TIER_SAMPLES) continue;
      const value = Math.round(median(sample));
      const tier = TIER_THRESHOLDS.find(([, min]) => value >= min)?.[0] ?? null;
      upsert.run(key, tier, value, sample.length);
    }
  })();
}

export interface PruneSummary {
  jobs: number;
  sourceRuns: number;
}

/**
 * Deletes jobs closed more than `afterDays` ago and source runs started more
 * than `afterDays` ago, in one transaction. 0 disables pruning.
 *
 * Nothing references a job row by id: `canonical` is a flag recomputed from
 * open rows only, the apply-link cache lives on the row itself, and
 * `companies` / `ats_boards` are keyed by company. The only link between rows
 * is the dedup `fingerprint`, so as a safeguard a closed job is kept while an
 * open job shares its fingerprint. Each source's latest finished run is kept
 * too, so /api/stats always has a "last run" to show.
 *
 * No VACUUM: SQLite reuses the freed pages for new rows, so the file stops
 * growing instead of shrinking, and a VACUUM would rewrite the whole database
 * (needing as much free disk again) while blocking the API.
 */
export function pruneOldRows(db: Db, now: Date, afterDays: number): PruneSummary {
  if (afterDays <= 0) return { jobs: 0, sourceRuns: 0 };
  const before = new Date(now.getTime() - afterDays * 86_400_000).toISOString();
  return db.transaction(() => ({
    jobs: db
      .prepare(
        `DELETE FROM jobs
         WHERE closed_at IS NOT NULL AND closed_at < ?
           AND NOT EXISTS (SELECT 1 FROM jobs o WHERE o.fingerprint = jobs.fingerprint AND o.closed_at IS NULL)`,
      )
      .run(before).changes,
    sourceRuns: db
      .prepare(
        `DELETE FROM source_runs
         WHERE started_at < ?
           AND id NOT IN (SELECT MAX(id) FROM source_runs WHERE finished_at IS NOT NULL GROUP BY source)`,
      )
      .run(before).changes,
  }))();
}

/**
 * Runs every due source (in parallel — they're different hosts), then the
 * post-processing that depends on the whole dataset.
 */
export async function runIngestion(db: Db, sources: SourceAdapter[], options: IngestionOptions): Promise<SourceRunSummary[]> {
  const now = options.now?.() ?? new Date();
  const summaries = await Promise.all(
    sources.map((source): Promise<SourceRunSummary> => {
      if (!options.force && !isDue(db, source, now, options.minIntervalMinutes)) {
        return Promise.resolve({ source: source.id, status: "skipped", fetched: 0, inserted: 0, closed: 0, errors: [] });
      }
      return ingestSource(db, source, now);
    }),
  );
  if (summaries.some((s) => s.status !== "skipped")) {
    retireStaleJobs(db, now, options.staleAfterDays);
    recomputeCanonical(db, now);
    recomputeCompanyTiers(db);
  }
  return summaries;
}
