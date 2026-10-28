import type { Db } from "../db/index.js";
import { errorMessage, mapLimit } from "../sources/http.js";
import { SOURCES } from "../sources/index.js";
import type { SourceAdapter } from "../sources/types.js";
import { countVerdicts, hoursBetween, percentile, type VerdictCounts } from "./metrics.js";
import { createRefLookup, type RefRow } from "./refs.js";
import { countReportsBySource } from "./reports.js";
import { createVerifier, type AuditNet, type PostingRef, type Verdict } from "./verify.js";

/**
 * The accuracy audit: for each source, re-checks a random sample of the roles
 * we show as open, and of the roles we closed in the last week, against the
 * employer's ATS, and records how often we were right.
 *
 * ATS sources are checked by their own board and id. Job-board roles are
 * checked through the ATS posting their apply link points to; one with no
 * such link is `unknown`. Since most job-board roles have none, rows are drawn
 * in random order until `openSample` (or `closedSample`) checkable ones are
 * found, or `maxDraw` rows were drawn: every drawn row counts as sampled, so
 * coverage shows how much of the source the precision speaks for.
 */

export interface AuditOptions {
  now: Date;
  sources?: readonly SourceAdapter[];
  /** Checkable open roles per source. */
  openSample?: number;
  /** Checkable recently closed roles per source. */
  closedSample?: number;
  /** Rows drawn at most per source and sample, checkable or not. */
  maxDraw?: number;
  /** Requests in flight at once (per-host spacing is up to the net). */
  concurrency?: number;
}

/** What "recently closed" means, and the window closure latency is measured over. */
export const CLOSED_WINDOW_DAYS = 7;
const MAX_MISMATCHES = 20;

interface JobRow extends RefRow {
  id: string;
}

export interface SourceAudit {
  source: string;
  kind: string;
  open: VerdictCounts;
  closed: VerdictCounts;
  latency: { count: number; p50Hours: number | null; p90Hours: number | null };
  mismatches: { shownOpenButClosed: string[]; closedButStillOpen: string[] };
  /** "Role closed?" reports on the source's roles in the last CLOSED_WINDOW_DAYS. */
  reports: number;
}

export interface AuditSummary {
  runId: number;
  sources: SourceAudit[];
}

/** Draws rows in order until `target` of them have a checkable posting. */
function draw(rows: readonly JobRow[], target: number, refFor: (row: JobRow) => PostingRef | null) {
  const drawn: { row: JobRow; ref: PostingRef | null }[] = [];
  let checkable = 0;
  for (const row of rows) {
    if (checkable >= target) break;
    const ref = refFor(row);
    drawn.push({ row, ref });
    if (ref) checkable += 1;
  }
  return drawn;
}

export async function runAccuracyAudit(db: Db, net: AuditNet, options: AuditOptions): Promise<AuditSummary> {
  const { now, sources = SOURCES, openSample = 50, closedSample = 20, maxDraw = 500, concurrency = 2 } = options;
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - CLOSED_WINDOW_DAYS * 86_400_000).toISOString();

  const runId = Number(db.prepare("INSERT INTO accuracy_runs (started_at) VALUES (?)").run(nowIso).lastInsertRowid);

  try {
    const columns = "id, source, feed, external_id, url, apply_url, description_links";
    const openRows = db.prepare(
      `SELECT ${columns} FROM jobs WHERE source = ? AND closed_at IS NULL AND canonical = 1 ORDER BY RANDOM() LIMIT ?`,
    );
    // Only closures visitors noticed: no other copy of the role is still open.
    const closedRows = db.prepare(
      `SELECT ${columns} FROM jobs WHERE source = ? AND closed_at >= ?
         AND NOT EXISTS (SELECT 1 FROM jobs o WHERE o.fingerprint = jobs.fingerprint AND o.closed_at IS NULL)
       ORDER BY RANDOM() LIMIT ?`,
    );
    const closures = db.prepare("SELECT last_seen_at, closed_at FROM jobs WHERE source = ? AND closed_at >= ?");
    const refFor = createRefLookup(db);

    const plans = sources.map((source) => ({
      source,
      open: draw(openRows.all(source.id, maxDraw) as JobRow[], openSample, refFor),
      closed: draw(closedRows.all(source.id, windowStart, maxDraw) as JobRow[], closedSample, refFor),
    }));

    const verify = createVerifier(net);
    const verdicts = new Map<string, Verdict>();
    const toCheck = [...new Map(plans.flatMap((p) => [...p.open, ...p.closed]).filter((d) => d.ref).map((d) => [d.row.id, d.ref as PostingRef])).entries()];
    await mapLimit(toCheck, concurrency, async ([id, ref]) => {
      verdicts.set(id, await verify(ref).catch((): Verdict => "unknown"));
    });
    const verdictOf = (d: { row: JobRow }): Verdict => verdicts.get(d.row.id) ?? "unknown";
    const reports = countReportsBySource(db, windowStart);

    const results = plans.map(({ source, open, closed }): SourceAudit => {
      const hours = (closures.all(source.id, windowStart) as { last_seen_at: string; closed_at: string }[]).map((r) =>
        Math.max(0, hoursBetween(r.last_seen_at, r.closed_at)),
      );
      return {
        source: source.id,
        kind: source.kind,
        open: countVerdicts(open.map(verdictOf)),
        closed: countVerdicts(closed.map(verdictOf)),
        latency: { count: hours.length, p50Hours: percentile(hours, 50), p90Hours: percentile(hours, 90) },
        mismatches: {
          shownOpenButClosed: open.filter((d) => verdictOf(d) === "closed").slice(0, MAX_MISMATCHES).map((d) => d.row.id),
          closedButStillOpen: closed.filter((d) => verdictOf(d) === "open").slice(0, MAX_MISMATCHES).map((d) => d.row.id),
        },
        reports: reports.get(source.id) ?? 0,
      };
    });

    const insert = db.prepare(
      `INSERT INTO accuracy_results (
         run_id, source, kind, open_sampled, open_open, open_closed, open_unknown,
         closed_sampled, closed_open, closed_closed, closed_unknown,
         latency_count, latency_p50_hours, latency_p90_hours, mismatches, reports
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (const r of results) {
        insert.run(
          runId, r.source, r.kind, r.open.sampled, r.open.open, r.open.closed, r.open.unknown,
          r.closed.sampled, r.closed.open, r.closed.closed, r.closed.unknown,
          r.latency.count, r.latency.p50Hours, r.latency.p90Hours, JSON.stringify(r.mismatches), r.reports,
        );
      }
      db.prepare("UPDATE accuracy_runs SET status = 'ok', finished_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
    })();
    return { runId, sources: results };
  } catch (err) {
    db.prepare("UPDATE accuracy_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(new Date().toISOString(), errorMessage(err), runId);
    throw err;
  }
}

/** Whether the last audit (successful or not) started more than `intervalDays` ago. */
export function isAuditDue(db: Db, now: Date, intervalDays: number): boolean {
  const last = db.prepare("SELECT MAX(started_at) AS at FROM accuracy_runs").get() as { at: string | null };
  return !last.at || Date.parse(last.at) <= now.getTime() - intervalDays * 86_400_000;
}

export function logAudit(summary: AuditSummary): void {
  for (const s of summary.sources) {
    if (s.open.sampled + s.closed.sampled + s.reports === 0) continue;
    console.log(
      `[accuracy] ${s.source}: open ${s.open.open}✓ ${s.open.closed}✗ ${s.open.unknown}? · ` +
        `recently closed ${s.closed.closed}✓ ${s.closed.open}✗ ${s.closed.unknown}? · ` +
        `latency p50=${s.latency.p50Hours?.toFixed(1) ?? "-"}h p90=${s.latency.p90Hours?.toFixed(1) ?? "-"}h (n=${s.latency.count}) · ` +
        `reports ${s.reports}`,
    );
  }
}
