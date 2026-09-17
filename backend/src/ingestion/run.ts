import { openDb } from "../db/index.js";
import { runIngestion } from "./pipeline.js";
import { greenhouseAdapter } from "../adapters/greenhouse.js";
import { leverAdapter } from "../adapters/lever.js";
import { remotiveAdapter } from "../adapters/remotive.js";
import { arbeitnowAdapter } from "../adapters/arbeitnow.js";

// CLI entrypoint for `npm run ingest`. Meant to be run manually or via cron;
// no in-process scheduler here.
async function main(): Promise<void> {
  const db = openDb();
  const adapters = [greenhouseAdapter, leverAdapter, remotiveAdapter, arbeitnowAdapter];

  console.log(`[ingest] starting ingestion from ${adapters.length} sources...`);
  const summary = await runIngestion(db, adapters);

  console.table(summary);
  const totals = summary.reduce(
    (acc, s) => ({ fetched: acc.fetched + s.fetched, inserted: acc.inserted + s.inserted }),
    { fetched: 0, inserted: 0 }
  );
  console.log(`[ingest] done. total fetched=${totals.fetched} total inserted=${totals.inserted}`);

  db.close();
}

main().catch((err) => {
  console.error("[ingest] fatal error:", err);
  process.exitCode = 1;
});
