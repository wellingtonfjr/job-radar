import { HIDDEN_BY_REPORTS, hiddenByReportsParams } from "../accuracy/reports.js";
import { CLOSED_VERDICTS_TO_CLOSE } from "../accuracy/verify.js";
import type { Db } from "../db/index.js";
import { isTechCategory, TECH_CATEGORIES, type NormalizedJob } from "../domain/job.js";
import { companyKey, isOpening, normalizeJob } from "../normalize/index.js";
import { toSearchKey } from "../normalize/text.js";
import { errorMessage } from "../sources/http.js";
import type { CompanyBoard } from "../sources/companies.js";
import type { FeedError, FeedResult, SourceAdapter } from "../sources/types.js";

export interface SourceRunSummary {
  source: string;
  status: "ok" | "partial" | "error" | "skipped";
  fetched: number;
  inserted: number;
  closed: number;
  /** Stored roles deleted because they passed MAX_LISTING_AGE_DAYS (not counted as closed). */
  aged?: number;
  /** Stored roles deleted because they aren't in a tech category (not counted as closed). */
  offTopic?: number;
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
  /**
   * Every registered source id. When given, open roles from any other source
   * (one that was removed from the registry) are closed, since nothing will
   * ever see them again.
   */
  knownSources?: string[];
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
    // Kept in job_descriptions; see the schema.
    description: null,
    descriptionLinks: JSON.stringify(job.descriptionLinks),
    searchText: toSearchKey([job.title, job.company, ...job.skills, ...job.tags].join(" ")),
    postedAt: job.postedAt,
    expiresAt: job.expiresAt,
    fingerprint: job.fingerprint,
    sourceRank,
    seenAt,
  };
}

/** Most discovered boards read per ATS in one run, on top of the curated ones. */
export const MAX_DISCOVERED_BOARDS = 100;

/**
 * Company boards on `provider` found by apply-link discovery
 * (resolve/atsDiscovery.ts), minus the curated ones. A board only counts
 * once a job-board listing was matched to one of its postings: that rules
 * out a token that happens to belong to another company. The oldest matches
 * come first, so a board keeps its slot from run to run.
 */
export function discoveredBoards(db: Db, provider: string, curated: readonly string[] = []): CompanyBoard[] {
  const skip = new Set(curated);
  const rows = db
    .prepare(
      `SELECT token, company_name AS name FROM ats_boards
       WHERE provider = ? AND token IS NOT NULL AND matched_at IS NOT NULL AND company_name IS NOT NULL
       GROUP BY token ORDER BY MIN(matched_at), token`,
    )
    .all(provider) as CompanyBoard[];
  return rows.filter((b) => !skip.has(b.token)).slice(0, MAX_DISCOVERED_BOARDS);
}

function isDue(db: Db, source: SourceAdapter, now: Date, floorMinutes = 0): boolean {
  // Failed runs don't count, and neither do runs that never finished (the
  // process stopped mid-run, e.g. for a deploy): both are retried right away.
  const last = db
    .prepare("SELECT started_at FROM source_runs WHERE source = ? AND status NOT IN ('error', 'running') ORDER BY started_at DESC LIMIT 1")
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
    const storedDescription = db.prepare(
      `SELECT COALESCE(d.description, j.description) AS description FROM jobs j
       LEFT JOIN job_descriptions d ON d.job_id = j.id WHERE j.source = ? AND j.external_id = ?`,
    );
    const discovered = source.feeds ? discoveredBoards(db, source.id, source.feeds) : [];
    const exists = db.prepare("SELECT 1 FROM jobs WHERE id = ?");
    const upsert = db.prepare(UPSERT_SQL);
    const putDescription = db.prepare(
      "INSERT INTO job_descriptions (job_id, description) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET description = excluded.description",
    );
    const dropDescription = db.prepare("DELETE FROM job_descriptions WHERE job_id = ?");
    const rememberAged = db.prepare(REMEMBER_AGED_SQL);
    const rememberAgedInFeed = db.prepare(
      `INSERT INTO aged_fingerprints (fingerprint, aged_at)
       SELECT fingerprint, @now FROM jobs WHERE source = @source AND feed = @feed AND posted_at < @postedBefore AND source_rank = 0
       ON CONFLICT(fingerprint) DO UPDATE SET aged_at = excluded.aged_at`,
    );
    const deleteAgedInFeed = db.prepare("DELETE FROM jobs WHERE source = @source AND feed = @feed AND posted_at < @postedBefore");
    const deleteOffTopicInFeed = db.prepare(`DELETE FROM jobs WHERE source = @source AND feed = @feed AND ${OFF_TOPIC_SQL}`);
    const deleteById = db.prepare("DELETE FROM jobs WHERE id = ?");
    const openInFeed = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE source = ? AND feed = ? AND closed_at IS NULL");
    // Anything in a complete feed that this run didn't touch is gone upstream.
    const closeMissing = db.prepare(
      "UPDATE jobs SET closed_at = @now WHERE source = @source AND feed = @feed AND closed_at IS NULL AND last_seen_at < @seenAt",
    );

    // Writes one feed's jobs. Called by the adapter as each board arrives
    // (`emit`), or below for adapters that return everything at once.
    let written = 0;
    // Postings published longer ago than the listing shows aren't stored at all.
    const postedBefore = now.getTime() - MAX_LISTING_AGE_DAYS * 86_400_000;
    const postedBeforeIso = new Date(postedBefore).toISOString();
    const writeResult = (result: FeedResult): void => {
      const seen = new Map<string, NormalizedJob>();
      const agedFingerprints = new Set<string>();
      let tooOld = 0;
      // Off-topic jobs this feed lists: deleted by id, in case one was stored as tech before.
      const offTopicIds: string[] = [];
      for (const raw of result.jobs) {
        try {
          const job = normalizeJob(source.id, result.feed, raw);
          if (!job.url) {
            // Not a web address (or a script/data URL): never stored, but
            // reported so a source sending bad links doesn't go unnoticed.
            summary.errors.push({ feed: result.feed, error: `rejected unsafe or invalid URL for ${raw.externalId}` });
            continue;
          }
          // Not a tech role: listed upstream, left out on purpose.
          if (!isTechCategory(job.category)) {
            offTopicIds.push(job.id);
            continue;
          }
          if (job.postedAt && Date.parse(job.postedAt) < postedBefore) {
            tooOld += 1;
            // Only the employer's own listing says the opening is still up.
            if (source.kind === "ats") agedFingerprints.add(job.fingerprint);
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
          if (job.description) putDescription.run(job.id, job.description);
          else dropDescription.run(job.id);
        }
        // Stored roles of this feed that are now too old go (after the upserts,
        // which refresh the date of roles reposted upstream). Not counted as closed.
        const aged = { now: startedAt, source: source.id, feed: result.feed, postedBefore: postedBeforeIso };
        for (const fp of agedFingerprints) rememberAged.run(fp, startedAt);
        rememberAgedInFeed.run(aged);
        summary.aged = (summary.aged ?? 0) + deleteAgedInFeed.run(aged).changes;
        let offTopic = deleteOffTopicInFeed.run({ source: source.id, feed: result.feed }).changes;
        for (const id of offTopicIds) offTopic += deleteById.run(id).changes;
        summary.offTopic = (summary.offTopic ?? 0) + offTopic;
        if (result.complete) {
          // Guard against partial responses: a "complete" board that suddenly
          // lists under half of what was open is more likely an upstream
          // glitch than mass hiring, so nothing is closed this run. Jobs the
          // adapter filtered out on purpose still count as listed.
          const open = (openInFeed.get(source.id, result.feed) as { n: number }).n;
          // Aged and off-topic stored rows were just deleted, so they're in neither count.
          const listed = seen.size + (result.skipped ?? 0);
          if (open >= MIN_FEED_FOR_DROP_GUARD && listed < open * DROP_GUARD_RATIO) {
            summary.errors.push({ feed: result.feed, error: `listed ${listed} of ${open} open jobs; not closing any this run` });
          } else {
            summary.closed += closeMissing.run({ now: startedAt, source: source.id, feed: result.feed, seenAt: startedAt }).changes;
          }
        }
      })();
      // Counted only once committed: a board whose write failed isn't "read".
      written += 1;
      summary.fetched += seen.size;
    };

    const outcome = await source.fetchJobs({
      storedDescription: (externalId) =>
        (storedDescription.get(source.id, externalId) as { description: string | null } | undefined)?.description ?? null,
      discoveredBoards: discovered,
      emit: writeResult,
    });
    // Fetch errors first, as before streaming: only the first 50 errors are stored.
    summary.errors.unshift(...outcome.errors);
    for (const result of outcome.results) writeResult(result);

    // A discovered board the ATS no longer has is forgotten; discovery may find it again later.
    const discoveredTokens = new Set(discovered.map((b) => b.token));
    const forgetBoard = db.prepare(
      "UPDATE ats_boards SET provider = NULL, token = NULL, matched_at = NULL, checked_at = ? WHERE provider = ? AND token = ?",
    );
    for (const error of outcome.errors) {
      if (error.gone && discoveredTokens.has(error.feed)) forgetBoard.run(startedAt, source.id, error.feed);
    }

    if (source.feeds && written > 0) {
      const feeds = [...source.feeds, ...discoveredTokens];
      const placeholders = feeds.map(() => "?").join(", ") || "NULL";
      summary.closed += db
        .prepare(`UPDATE jobs SET closed_at = ? WHERE source = ? AND closed_at IS NULL AND feed NOT IN (${placeholders})`)
        .run(startedAt, source.id, ...feeds).changes;
    }

    if (summary.errors.length > 0) summary.status = written > 0 ? "partial" : "error";
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

/** Closes open roles from sources that are no longer registered. */
export function retireRemovedSources(db: Db, now: Date, knownSources: string[]): number {
  if (knownSources.length === 0) return 0;
  const placeholders = knownSources.map(() => "?").join(", ");
  return db
    .prepare(`UPDATE jobs SET closed_at = ? WHERE closed_at IS NULL AND source NOT IN (${placeholders})`)
    .run(now.toISOString(), ...knownSources).changes;
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
 * Postings older than this are left out of the default listing. A role
 * posted months ago that is still on the board is usually an evergreen
 * "talent pool" (some Lever boards keep the same posting open for years) or
 * a hard-to-fill role, not what someone looking for a job now wants to see.
 */
export const MAX_LISTING_AGE_DAYS = 60;

/**
 * Decides which open jobs the default listing shows (`canonical = 1`); the
 * listing, its counts, /api/stats, the sitemap and RSS all filter on it.
 *
 * - Cross-source copies of the same opening are hidden: a job is
 *   non-canonical when another *source* has it open with a better rank (the
 *   employer's own ATS beats aggregators). Same-source matches are left
 *   alone — one company posting "Account Executive" in five cities is five
 *   real openings.
 * - Postings older than MAX_LISTING_AGE_DAYS are hidden, from every source.
 *   Dated ones aren't stored at all past that age (see ingestSource and
 *   pruneOldRows); this mostly hides undated roles, by when we first saw
 *   them. Those stay open (their page works by link, and the `source`
 *   filter still shows them) and still hide their job-board copies.
 * - Roles with enough recent "Role closed?" reports are hidden pending
 *   review (see accuracy/reports.ts). Like old postings they stay open,
 *   so they still hide their copies: a report hides the opening, not just
 *   one source's listing of it.
 */
export function recomputeCanonical(db: Db, now: Date): void {
  const postedBefore = new Date(now.getTime() - MAX_LISTING_AGE_DAYS * 86_400_000).toISOString();
  db.prepare(
    `UPDATE jobs SET canonical = closed_at IS NULL
      AND COALESCE(posted_at, first_seen_at) >= @postedBefore
      AND NOT ${HIDDEN_BY_REPORTS}
      -- A job board's copy of an opening the employer posted too long ago and
      -- still lists (remembered from an employer run in the last week).
      AND NOT (jobs.source_rank > 0 AND EXISTS (
        SELECT 1 FROM aged_fingerprints a WHERE a.fingerprint = jobs.fingerprint AND a.aged_at >= @agedSince
      ))
      AND NOT EXISTS (
        SELECT 1 FROM jobs o
        WHERE o.fingerprint = jobs.fingerprint
          AND o.source != jobs.source
          AND o.closed_at IS NULL
          AND (o.source_rank < jobs.source_rank OR (o.source_rank = jobs.source_rank AND o.source < jobs.source))
      )`,
  ).run({ postedBefore, agedSince: new Date(now.getTime() - AGED_MEMORY_DAYS * 86_400_000).toISOString(), ...hiddenByReportsParams(now) });
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
  reports: number;
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
 * too, so /api/stats always has a "last run" to show. "Role closed?" reports
 * only count for a week, so old ones go too (with their role, or not).
 *
 * Roles published more than MAX_LISTING_AGE_DAYS ago are deleted, open or
 * not: the listing never shows them and ingestion no longer stores them
 * (one still on its board this long is rarely a live opening). Roles without
 * a publication date are left alone: deleting them by first-seen date would
 * bring them back as "new" at the next run.
 *
 * No VACUUM here: SQLite reuses the freed pages for new rows, so the file
 * stops growing instead of shrinking (see compactOnce for the one-off).
 */
export function pruneOldRows(db: Db, now: Date, afterDays: number): PruneSummary {
  if (afterDays <= 0) return { jobs: 0, sourceRuns: 0, reports: 0 };
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
    reports: (() => {
      // Remembered aged openings are forgotten after the same window.
      db.prepare("DELETE FROM aged_fingerprints WHERE aged_at < ?").run(before);
      return db.prepare("DELETE FROM job_reports WHERE created_at < ?").run(before).changes;
    })(),
  }))();
}

/** Roles outside TECH_CATEGORIES (category ids are fixed identifiers, safe to inline). */
const OFF_TOPIC_SQL = `category NOT IN (${TECH_CATEGORIES.map((c) => `'${c}'`).join(", ")})`;

/**
 * Deletes stored roles that aren't in a tech category, from every source, in
 * batches with pauses so the API keeps answering. Ingestion already skips
 * them; this clears what was stored before (and roles reclassified since).
 */
export async function deleteOffTopicRoles(db: Db, { batchSize = 2000, pauseMs = 200 }: { batchSize?: number; pauseMs?: number } = {}): Promise<number> {
  const select = db.prepare(`SELECT rowid AS rid FROM jobs WHERE ${OFF_TOPIC_SQL} LIMIT ?`);
  const remove = db.prepare("DELETE FROM jobs WHERE rowid = ?");
  let total = 0;
  for (;;) {
    const rows = select.all(batchSize) as { rid: number }[];
    if (rows.length === 0) break;
    db.transaction(() => {
      for (const row of rows) remove.run(row.rid);
    })();
    total += rows.length;
    if (rows.length < batchSize) break;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  if (total > 0) db.pragma("wal_checkpoint(TRUNCATE)");
  return total;
}

/** How recently an employer run must have listed an aged opening for its board copies to stay hidden. */
const AGED_MEMORY_DAYS = 7;

const REMEMBER_AGED_SQL =
  "INSERT INTO aged_fingerprints (fingerprint, aged_at) VALUES (?, ?) ON CONFLICT(fingerprint) DO UPDATE SET aged_at = excluded.aged_at";

/**
 * Deletes roles published more than MAX_LISTING_AGE_DAYS ago, open or not,
 * from every source (complete feeds already drop theirs during ingestion;
 * this catches partially read feeds and the backlog). Employer (ATS) rows'
 * fingerprints are remembered so job-board copies stay hidden. Undated roles are left alone:
 * deleting them by first-seen date would bring them back as "new".
 *
 * In batches with pauses, by the posted_at index, so a large first run
 * doesn't block the API; the WAL is truncated afterwards.
 */
export async function deleteAgedPostings(
  db: Db,
  now: Date,
  { batchSize = 2000, pauseMs = 200 }: { batchSize?: number; pauseMs?: number } = {},
): Promise<number> {
  const postedBefore = new Date(now.getTime() - MAX_LISTING_AGE_DAYS * 86_400_000).toISOString();
  const nowIso = now.toISOString();
  const select = db.prepare("SELECT rowid AS rid, fingerprint, source_rank FROM jobs WHERE posted_at < ? LIMIT ?");
  const remember = db.prepare(REMEMBER_AGED_SQL);
  const remove = db.prepare("DELETE FROM jobs WHERE rowid = ?");
  let total = 0;
  for (;;) {
    const rows = select.all(postedBefore, batchSize) as { rid: number; fingerprint: string; source_rank: number }[];
    if (rows.length === 0) break;
    db.transaction(() => {
      for (const row of rows) {
        if (row.source_rank === 0) remember.run(row.fingerprint, nowIso);
        remove.run(row.rid);
      }
    })();
    total += rows.length;
    if (rows.length < batchSize) break;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  if (total > 0) db.pragma("wal_checkpoint(TRUNCATE)");
  return total;
}

/**
 * Runs every due source, one at a time, then the post-processing that
 * depends on the whole dataset. One at a time on purpose: the app runs on a
 * single 512 MB machine, and several large ATS runs at once (each holding
 * the boards in flight, with full descriptions) ran it out of memory.
 */
export async function runIngestion(db: Db, sources: SourceAdapter[], options: IngestionOptions): Promise<SourceRunSummary[]> {
  const now = options.now?.() ?? new Date();
  const summaries: SourceRunSummary[] = [];
  for (const source of sources) {
    if (!options.force && !isDue(db, source, now, options.minIntervalMinutes)) {
      summaries.push({ source: source.id, status: "skipped", fetched: 0, inserted: 0, closed: 0, errors: [] });
      continue;
    }
    summaries.push(await ingestSource(db, source, now));
  }
  if (summaries.some((s) => s.status !== "skipped")) {
    if (options.knownSources) retireRemovedSources(db, now, options.knownSources);
    retireStaleJobs(db, now, options.staleAfterDays);
    recomputeCanonical(db, now);
    recomputeCompanyTiers(db);
  }
  return summaries;
}
