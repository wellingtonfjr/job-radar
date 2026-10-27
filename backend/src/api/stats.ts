import { Router } from "express";
import type { Db } from "../db/index.js";
import { CATEGORIES } from "../domain/job.js";
import { SOURCES } from "../sources/index.js";

interface RunRow {
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched: number;
  inserted: number;
  closed: number;
  errors: string;
}

const OPEN = "closed_at IS NULL AND canonical = 1";

/**
 * Headline numbers, facet counts and per-source health. Everything here is
 * computed from what's actually stored, so the UI never shows invented
 * figures.
 */
export function getStats(db: Db, now: Date) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const posted = "COALESCE(posted_at, first_seen_at)";

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS openJobs,
         COUNT(DISTINCT company_key) AS companies,
         SUM(workplace = 'remote') AS remote,
         SUM(salary_min IS NOT NULL OR salary_max IS NOT NULL) AS withSalary,
         SUM(${posted} >= @weekAgo) AS newLast7Days,
         SUM(${posted} >= @dayAgo) AS postedToday
       FROM jobs WHERE ${OPEN}`,
    )
    .get({ weekAgo, dayAgo }) as Record<string, number | null>;

  const categoryCounts = new Map(
    (db.prepare(`SELECT category, COUNT(*) AS n FROM jobs WHERE ${OPEN} GROUP BY category`).all() as { category: string; n: number }[]).map(
      (r) => [r.category, r.n],
    ),
  );

  const skills = db
    .prepare(
      `SELECT s.value AS name, COUNT(*) AS count FROM jobs, json_each(jobs.skills) s
       WHERE ${OPEN} GROUP BY s.value ORDER BY count DESC LIMIT 40`,
    )
    .all() as { name: string; count: number }[];

  const countries = (
    db
      .prepare(
        `SELECT DISTINCT ac.value AS code FROM jobs, json_each(jobs.allowed_countries) ac
         WHERE ${OPEN} ORDER BY code`,
      )
      .all() as { code: string }[]
  ).map((r) => r.code);

  const tierCounts = db
    .prepare("SELECT tier, COUNT(*) AS n FROM companies WHERE tier IS NOT NULL GROUP BY tier")
    .all() as { tier: string; n: number }[];

  const openBySource = new Map(
    (db.prepare("SELECT source, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL GROUP BY source").all() as { source: string; n: number }[]).map(
      (r) => [r.source, r.n],
    ),
  );
  const lastRuns = new Map(
    (
      db
        .prepare(
          `SELECT r.* FROM source_runs r
           JOIN (SELECT source, MAX(id) AS id FROM source_runs WHERE finished_at IS NOT NULL GROUP BY source) last ON last.id = r.id`,
        )
        .all() as RunRow[]
    ).map((r) => [r.source, r]),
  );

  const sources = SOURCES.map((s) => {
    const run = lastRuns.get(s.id);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      homepage: s.homepage,
      openJobs: openBySource.get(s.id) ?? 0,
      lastRun: run
        ? {
            startedAt: run.started_at,
            finishedAt: run.finished_at,
            status: run.status,
            fetched: run.fetched,
            inserted: run.inserted,
            closed: run.closed,
            errorCount: (JSON.parse(run.errors) as unknown[]).length,
          }
        : null,
    };
  });

  const finished = sources.map((s) => s.lastRun?.finishedAt).filter((t): t is string => Boolean(t));

  return {
    totals: {
      openJobs: totals.openJobs ?? 0,
      companies: totals.companies ?? 0,
      remote: totals.remote ?? 0,
      withSalary: totals.withSalary ?? 0,
      newLast7Days: totals.newLast7Days ?? 0,
      postedToday: totals.postedToday ?? 0,
    },
    categories: CATEGORIES.map((c) => ({ ...c, count: categoryCounts.get(c.id) ?? 0 })),
    skills,
    countries,
    tiers: Object.fromEntries(tierCounts.map((t) => [t.tier, t.n])),
    sources,
    lastUpdatedAt: finished.length > 0 ? finished.sort().at(-1) : null,
  };
}

export function createStatsRouter(db: Db): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json(getStats(db, new Date()));
  });
  return router;
}
