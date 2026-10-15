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
  /** Run due sources on startup and then on this cadence. 0 disables. */
  schedulerTickMinutes: process.env.SCHEDULER === "off" ? 0 : intFromEnv("SCHEDULER_TICK_MINUTES", 15),
  /**
   * Jobs from feeds we can't read completely are closed after this many
   * days without being seen again (see ingestion/pipeline.ts).
   */
  staleAfterDays: intFromEnv("STALE_AFTER_DAYS", 30),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
