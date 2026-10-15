import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { startScheduler } from "./ingestion/scheduler.js";
import { SOURCES } from "./sources/index.js";

const db = openDb(config.dbPath);
const app = createApp(db, { corsOrigin: config.corsOrigin });

const server = app.listen(config.port, () => {
  console.log(`job-radar API listening on http://localhost:${config.port}`);
});

const scheduler =
  config.schedulerTickMinutes > 0
    ? startScheduler(db, SOURCES, { tickMinutes: config.schedulerTickMinutes, staleAfterDays: config.staleAfterDays })
    : null;
if (!scheduler) console.log("[ingest] scheduler disabled (SCHEDULER=off); run `npm run ingest` manually.");

function shutdown(): void {
  scheduler?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
