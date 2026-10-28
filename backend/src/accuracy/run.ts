import { config } from "../config.js";
import { openDb } from "../db/index.js";
import { logAudit, runAccuracyAudit } from "./audit.js";
import { createAuditNet } from "./verify.js";

/**
 * CLI: `npm run audit:accuracy` runs one accuracy audit against DB_PATH and
 * records it (the scheduler also runs one weekly). In production:
 * `fly ssh console -C "node dist/accuracy/run.js"`.
 */
async function main(): Promise<void> {
  const db = openDb(config.dbPath);
  console.log(`[accuracy] auditing → ${config.dbPath}`);
  const summary = await runAccuracyAudit(db, createAuditNet(), { now: new Date() });
  logAudit(summary);
  console.log(`[accuracy] run ${summary.runId} recorded; see /api/accuracy.`);
  db.close();
}

main().catch((err: unknown) => {
  console.error("[accuracy] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
