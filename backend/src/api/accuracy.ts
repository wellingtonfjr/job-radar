import { Router } from "express";
import type { Db } from "../db/index.js";
import { coverage, falseClosureRate, openPrecision, type VerdictCounts } from "../accuracy/metrics.js";

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string;
}

interface ResultRow {
  source: string;
  kind: string;
  open_sampled: number;
  open_open: number;
  open_closed: number;
  open_unknown: number;
  closed_sampled: number;
  closed_open: number;
  closed_closed: number;
  closed_unknown: number;
  latency_count: number;
  latency_p50_hours: number | null;
  latency_p90_hours: number | null;
}

/**
 * The latest successful accuracy audit, per source (see accuracy/audit.ts).
 * Rates are null when nothing could be verified; `run` is null before the
 * first audit.
 */
export function getAccuracy(db: Db) {
  const run = db
    .prepare("SELECT id, started_at, finished_at FROM accuracy_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1")
    .get() as RunRow | undefined;
  if (!run) return { run: null, sources: [] };

  const rows = db.prepare("SELECT * FROM accuracy_results WHERE run_id = ? ORDER BY rowid").all(run.id) as ResultRow[];
  return {
    run: { id: run.id, startedAt: run.started_at, finishedAt: run.finished_at },
    sources: rows.map((r) => {
      const open: VerdictCounts = { sampled: r.open_sampled, open: r.open_open, closed: r.open_closed, unknown: r.open_unknown };
      const closed: VerdictCounts = { sampled: r.closed_sampled, open: r.closed_open, closed: r.closed_closed, unknown: r.closed_unknown };
      return {
        source: r.source,
        kind: r.kind,
        // Roles shown as open: open/closed upstream, or unknown.
        open: { ...open, verified: open.open + open.closed, precision: openPrecision(open) },
        // Roles closed in the last 7 days: still open upstream (a false closure), closed, or unknown.
        closed: { ...closed, verified: closed.open + closed.closed, falseClosureRate: falseClosureRate(closed) },
        latency: { count: r.latency_count, p50Hours: r.latency_p50_hours, p90Hours: r.latency_p90_hours },
        coverage: coverage(open, closed),
      };
    }),
  };
}

export function createAccuracyRouter(db: Db): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json(getAccuracy(db));
  });
  return router;
}
