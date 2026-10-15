import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./schema.js";

/** Opens (and migrates) the database. Pass ":memory:" for tests. */
export function openDb(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export type Db = Database.Database;
