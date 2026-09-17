import type Database from "better-sqlite3";

interface TableInfoRow {
  name: string;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      remote INTEGER NOT NULL DEFAULT 0,
      allowed_countries TEXT,
      url TEXT NOT NULL,
      description TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      posted_at TEXT,
      first_seen_at TEXT NOT NULL,
      UNIQUE(source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
  `);

  // CREATE TABLE IF NOT EXISTS doesn't add columns to a table that already
  // existed before this field was introduced — patch it in for DBs created
  // by an earlier version of job-radar.
  const columns = db.prepare("PRAGMA table_info(jobs)").all() as TableInfoRow[];
  if (!columns.some((c) => c.name === "allowed_countries")) {
    db.exec("ALTER TABLE jobs ADD COLUMN allowed_countries TEXT");
  }
}
