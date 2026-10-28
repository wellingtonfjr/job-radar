import { config } from "../config.js";
import { openDb } from "../db/index.js";
import { SOURCES, findSource } from "../sources/index.js";
import { liveNet } from "../resolve/net.js";
import { resolveApplyLinks } from "../resolve/resolver.js";
import { pruneOldRows, runIngestion, staleWindowsFor } from "./pipeline.js";
import { logPrune, logResolve } from "./scheduler.js";

/**
 * CLI: `npm run ingest` runs every due source once;
 * `npm run ingest -- --force [source...]` ignores the per-source intervals.
 * Afterwards, direct employer links are resolved for board listings
 * (`--no-resolve` skips it; `--resolve-only` skips fetching sources).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const resolve = !args.includes("--no-resolve");
  const resolveOnly = args.includes("--resolve-only");
  // e.g. `npm run resolve -- --discovery-budget=500` for a first backfill.
  const budgetArg = args.find((a) => a.startsWith("--discovery-budget="));
  const discoveryBudget = budgetArg ? Number.parseInt(budgetArg.split("=")[1] ?? "", 10) : undefined;
  const ids = args.filter((a) => !a.startsWith("--"));
  const unknown = ids.filter((id) => !findSource(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown source(s): ${unknown.join(", ")}. Known: ${SOURCES.map((s) => s.id).join(", ")}`);
  }
  const sources = ids.length > 0 ? SOURCES.filter((s) => ids.includes(s.id)) : SOURCES;

  const db = openDb(config.dbPath);
  if (!resolveOnly) {
    console.log(`[ingest] ${sources.length} source(s)${force ? " (forced)" : ""} → ${config.dbPath}`);
    const summaries = await runIngestion(db, sources, {
      force,
      // Every source's window: stale roles are retired across all sources, not just these.
      staleAfterDays: staleWindowsFor(SOURCES, config.staleAfterDays, config.jobBoardStaleAfterDays),
      minIntervalMinutes: config.ingestIntervalHours * 60,
      // Close roles left behind by sources removed from the registry.
      knownSources: SOURCES.map((s) => s.id),
    });
    console.table(
      summaries.map(({ errors, ...s }) => ({ ...s, errors: errors.length, firstError: errors[0] ? `${errors[0].feed}: ${errors[0].error}` : "" })),
    );
    if (summaries.some((s) => s.status !== "skipped")) logPrune(pruneOldRows(db, new Date(), config.pruneAfterDays), config.pruneAfterDays);
  }
  if (resolve || resolveOnly) logResolve(await resolveApplyLinks(db, liveNet, { now: new Date(), discoveryBudget }));
  const open = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE closed_at IS NULL AND canonical = 1").get() as { n: number };
  console.log(`[ingest] done. ${open.n} open jobs (deduplicated).`);
  db.close();
}

main().catch((err: unknown) => {
  console.error("[ingest] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
