import type { Db } from "../db/index.js";
import { liveNet } from "../resolve/net.js";
import { resolveApplyLinks, type ResolveSummary } from "../resolve/resolver.js";
import type { SourceAdapter } from "../sources/types.js";
import { runIngestion, type SourceRunSummary } from "./pipeline.js";

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

function logSummaries(summaries: SourceRunSummary[]): void {
  for (const s of summaries) {
    if (s.status === "skipped") continue;
    const errors = s.errors.length > 0 ? ` errors=${s.errors.length} (first: ${s.errors[0]?.feed}: ${s.errors[0]?.error})` : "";
    console.log(`[ingest] ${s.source}: ${s.status} fetched=${s.fetched} new=${s.inserted} closed=${s.closed}${errors}`);
  }
}

/**
 * In-process scheduler: every tick, runs the sources whose minimum interval
 * has elapsed. Cycles never overlap — a tick that fires while one is running
 * is skipped.
 */
export function startScheduler(
  db: Db,
  sources: SourceAdapter[],
  { tickMinutes, staleAfterDays }: { tickMinutes: number; staleAfterDays: number },
): Scheduler {
  let running: Promise<void> | null = null;

  const tick = (): void => {
    if (running) return;
    running = runIngestion(db, sources, { staleAfterDays })
      .then(logSummaries)
      // Then point board listings at the employers' own postings.
      .then(() => resolveApplyLinks(db, liveNet, { now: new Date() }))
      .then(logResolve)
      .catch((err: unknown) => console.error("[ingest] cycle failed:", err))
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
