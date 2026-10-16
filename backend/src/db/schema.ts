import type Database from "better-sqlite3";

/** Ordered migrations; `user_version` records how many have been applied. */
const MIGRATIONS: ((db: Database.Database) => void)[] = [
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      feed TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      company_key TEXT NOT NULL,
      company_logo TEXT,
      url TEXT NOT NULL,
      locations TEXT NOT NULL DEFAULT '[]',
      workplace TEXT NOT NULL,
      allowed_countries TEXT,
      category TEXT NOT NULL,
      seniority TEXT,
      employment_type TEXT,
      salary_min REAL,
      salary_max REAL,
      salary_currency TEXT,
      salary_period TEXT,
      salary_min_usd_year INTEGER,
      skills TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      search_text TEXT NOT NULL,
      posted_at TEXT,
      expires_at TEXT,
      fingerprint TEXT NOT NULL,
      source_rank INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      closed_at TEXT,
      -- 1 for the copy shown when the same opening exists in several sources.
      canonical INTEGER NOT NULL DEFAULT 1,
      UNIQUE(source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_listing ON jobs(closed_at, canonical, posted_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_source_feed ON jobs(source, feed, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_jobs_company_key ON jobs(company_key);
    CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);

    CREATE TABLE IF NOT EXISTS companies (
      company_key TEXT PRIMARY KEY,
      tier TEXT,
      median_salary_usd INTEGER,
      salary_samples INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS source_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      fetched INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      closed INTEGER NOT NULL DEFAULT 0,
      errors TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_source_runs_source ON source_runs(source, started_at);
  `),

  // Direct employer links for jobs that came from job boards (see resolve/).
  (db) => db.exec(`
    -- Job-posting links found in the source's description HTML.
    ALTER TABLE jobs ADD COLUMN description_links TEXT NOT NULL DEFAULT '[]';
    -- The employer's own posting, when it could be verified.
    ALTER TABLE jobs ADD COLUMN apply_url TEXT;
    ALTER TABLE jobs ADD COLUMN apply_method TEXT;
    ALTER TABLE jobs ADD COLUMN apply_checked_at TEXT;

    -- Cache of "does this company have a public ATS board, and where".
    CREATE TABLE IF NOT EXISTS ats_boards (
      company_key TEXT PRIMARY KEY,
      provider TEXT,
      token TEXT,
      checked_at TEXT NOT NULL
    );
  `),
];

export function migrate(db: Database.Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      (MIGRATIONS[i] as (db: Database.Database) => void)(db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
