import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  port: intFromEnv("PORT", 3001),
  dbPath: process.env.DB_PATH ?? path.join(backendRoot, "data", "job-radar.db"),
  /** Built frontend (frontend/dist) served by the API in production. */
  frontendDist: process.env.FRONTEND_DIST ?? path.resolve(backendRoot, "..", "frontend", "dist"),
  /**
   * How often each source is refreshed (at least; a source's own minimum
   * interval wins when longer). Twice a day keeps listings current: jobs
   * rarely change by the hour, and providers ask not to be polled often.
   */
  ingestIntervalHours: intFromEnv("INGEST_INTERVAL_HOURS", 12),
  /**
   * How often the in-process scheduler checks for due sources (it runs on
   * startup too). Checking is free; fetching only happens when due. 0 disables.
   */
  schedulerTickMinutes: process.env.SCHEDULER === "off" ? 0 : intFromEnv("SCHEDULER_TICK_MINUTES", 60),
  /**
   * Jobs from feeds we can't read completely are closed after this many
   * days without being seen again (see ingestion/pipeline.ts).
   */
  staleAfterDays: intFromEnv("STALE_AFTER_DAYS", 30),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
