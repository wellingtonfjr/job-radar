import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { startScheduler } from "./ingestion/scheduler.js";
import { SOURCES } from "./sources/index.js";

const db = openDb(config.dbPath);
const app = createApp(db, {
  corsOrigin: config.corsOrigin,
  staticDir: config.frontendDist,
  rateLimitPerMinute: config.rateLimitPerMinute,
  siteUrl: config.siteUrl,
});
const servesFrontend = fs.existsSync(path.join(config.frontendDist, "index.html"));

const server = app.listen(config.port, () => {
  console.log(`job-radar API listening on http://localhost:${config.port}`);
  console.log(
    servesFrontend
      ? `[web] serving the built frontend from ${config.frontendDist}`
      : "[web] no frontend build found; API only (use the Vite dev server for the UI)",
  );
});

const scheduler =
  config.schedulerTickMinutes > 0
    ? startScheduler(db, SOURCES, {
        tickMinutes: config.schedulerTickMinutes,
        staleAfterDays: config.staleAfterDays,
        ingestIntervalHours: config.ingestIntervalHours,
        pruneAfterDays: config.pruneAfterDays,
      })
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
