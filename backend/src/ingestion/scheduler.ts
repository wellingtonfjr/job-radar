import { isAuditDue, logAudit, runAccuracyAudit, type AuditSummary } from "../accuracy/audit.js";
import { LIVENESS_USER_AGENT, livenessBudget, logLiveness, runLivenessCheck, type LivenessSummary } from "../accuracy/liveness.js";
import { createAuditNet } from "../accuracy/verify.js";
import type { Db } from "../db/index.js";
import { liveNet } from "../resolve/net.js";
import { resolveApplyLinks, type ResolveSummary } from "../resolve/resolver.js";
import type { SourceAdapter } from "../sources/types.js";
import { pruneOldRows, runIngestion, type PruneSummary, type SourceRunSummary, type StaleWindows } from "./pipeline.js";

export interface Scheduler {
  stop(): void;
  /** Resolves when the in-flight cycle (if any) finishes. */
  idle(): Promise<void>;
}

export function logResolve(summary: ResolveSummary): void {
  const found = Object.entries(summary.resolved)
    .filter(([, n]) => n > 0)
    .map(([method, n]) => `${method}=${n}`)
    .join(" ");
  console.log(
    `[resolve] direct links: ${found || "none"} · no direct link=${summary.unresolved} · deferred=${summary.deferred}` +
      (summary.errors.length ? ` · errors=${summary.errors.length}` : ""),
  );
}

export function logPrune(summary: PruneSummary, afterDays: number): void {
  if (afterDays <= 0) return;
  console.log(`[ingest] pruned (older than ${afterDays}d): closed jobs=${summary.jobs} source runs=${summary.sourceRuns}`);
}

function logSummaries(summaries: SourceRunSummary[]): void {
  for (const s of summaries) {
    if (s.status === "skipped") continue;
    const errors = s.errors.length > 0 ? ` errors=${s.errors.length} (first: ${s.errors[0]?.feed}: ${s.errors[0]?.error})` : "";
    console.log(`[ingest] ${s.source}: ${s.status} fetched=${s.fetched} new=${s.inserted} closed=${s.closed}${errors}`);
  }
}

/** Runs one accuracy audit; swapped for a fake in tests. */
export type AuditRunner = (db: Db, now: Date) => Promise<AuditSummary>;

const liveAudit: AuditRunner = (db, now) => runAccuracyAudit(db, createAuditNet(), { now });

/** Runs one liveness check within `budget` requests; swapped for a fake in tests. */
export type LivenessRunner = (db: Db, now: Date, budget: number) => Promise<LivenessSummary>;

const liveLiveness: LivenessRunner = (db, now, budget) =>
  runLivenessCheck(db, createAuditNet({ userAgent: LIVENESS_USER_AGENT }), { now, budget });

/**
 * In-process scheduler: every tick, runs the sources whose minimum interval
 * has elapsed, then the accuracy audit when the last one is older than
 * `accuracyAuditDays`, then a liveness check of job-board roles within
 * `livenessRequestsPerHour`. Cycles never overlap — a tick that fires while
 * one is running is skipped.
 */
export function startScheduler(
  db: Db,
  sources: SourceAdapter[],
  {
    tickMinutes,
    staleAfterDays,
    ingestIntervalHours,
    pruneAfterDays,
    accuracyAuditDays = 0,
    runAudit = liveAudit,
    livenessRequestsPerHour = 0,
    runLiveness = liveLiveness,
  }: {
    tickMinutes: number;
    staleAfterDays: number | StaleWindows;
    ingestIntervalHours: number;
    pruneAfterDays: number;
    /** Days between accuracy audits; 0 disables them. */
    accuracyAuditDays?: number;
    runAudit?: AuditRunner;
    /** Liveness-check requests per hour; 0 disables it. */
    livenessRequestsPerHour?: number;
    runLiveness?: LivenessRunner;
  },
): Scheduler {
  let running: Promise<void> | null = null;

  const tick = (): void => {
    if (running) return;
    running = runIngestion(db, sources, { staleAfterDays, minIntervalMinutes: ingestIntervalHours * 60 })
      .then((summaries) => {
        logSummaries(summaries);
        // Housekeeping only after a cycle that actually fetched something.
        if (summaries.some((s) => s.status !== "skipped")) logPrune(pruneOldRows(db, new Date(), pruneAfterDays), pruneAfterDays);
        return summaries;
      })
      // Then point board listings at the employers' own postings.
      .then((summaries) =>
        // Resolve only after a cycle that actually fetched something.
        summaries.some((s) => s.status !== "skipped") ? resolveApplyLinks(db, liveNet, { now: new Date() }).then(logResolve) : undefined,
      )
      .catch((err: unknown) => console.error("[ingest] cycle failed:", err))
      // Weekly, after ingestion so the two never compete. Due-ness is read
      // from the database, so restarts and deploys don't trigger extra runs.
      .then(async () => {
        const now = new Date();
        if (accuracyAuditDays > 0 && isAuditDue(db, now, accuracyAuditDays)) logAudit(await runAudit(db, now));
      })
      .catch((err: unknown) => console.error("[accuracy] audit failed:", err))
      // Every tick, spending what the hourly budget has accrued since the last check.
      .then(async () => {
        const now = new Date();
        const budget = livenessBudget(db, now, livenessRequestsPerHour);
        if (budget > 0) logLiveness(await runLiveness(db, now, budget), budget);
      })
      .catch((err: unknown) => console.error("[liveness] check failed:", err))
      .finally(() => {
        running = null;
      });
  };

  tick();
  const timer = setInterval(tick, tickMinutes * 60_000);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
    idle: () => running ?? Promise.resolve(),
  };
}
