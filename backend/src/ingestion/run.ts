import { config } from "../config.js";
import { openDb } from "../db/index.js";
import { SOURCES, findSource } from "../sources/index.js";
import { runIngestion } from "./pipeline.js";

/**
 * CLI: `npm run ingest` runs every due source once;
 * `npm run ingest -- --force [source...]` ignores the per-source intervals.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const ids = args.filter((a) => !a.startsWith("--"));
  const unknown = ids.filter((id) => !findSource(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown source(s): ${unknown.join(", ")}. Known: ${SOURCES.map((s) => s.id).join(", ")}`);
  }
  const sources = ids.length > 0 ? SOURCES.filter((s) => ids.includes(s.id)) : SOURCES;

  const db = openDb(config.dbPath);
  console.log(`[ingest] ${sources.length} source(s)${force ? " (forced)" : ""} → ${config.dbPath}`);
  const summaries = await runIngestion(db, sources, { force, staleAfterDays: config.staleAfterDays });
  console.table(
    summaries.map(({ errors, ...s }) => ({ ...s, errors: errors.length, firstError: errors[0] ? `${errors[0].feed}: ${errors[0].error}` : "" })),
  );
  const open = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE closed_at IS NULL AND canonical = 1").get() as { n: number };
  console.log(`[ingest] done. ${open.n} open jobs (deduplicated).`);
  db.close();
}

main().catch((err: unknown) => {
  console.error("[ingest] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
