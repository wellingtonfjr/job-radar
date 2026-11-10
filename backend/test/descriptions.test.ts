import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { cachedStats } from "../src/api/stats.js";
import { compactOnce, descriptionsMoved, moveDescriptions, moveDescriptionsBatch } from "../src/db/descriptions.js";
import { openDb, type Db } from "../src/db/index.js";
import { pruneOldRows, runIngestion } from "../src/ingestion/pipeline.js";
import { findOpenJob } from "../src/web/seo.js";
import { fakeSource, rawJob } from "./helpers.js";

const T0 = new Date("2026-10-15T12:00:00Z");
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3_600_000);

let db: Db;
let server: Server | null = null;

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => {
  server?.close();
  server = null;
});

async function serve(): Promise<string> {
  server = createApp(db).listen(0);
  await new Promise((r) => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const stored = (id: string) => ({
  inJobs: (db.prepare("SELECT description FROM jobs WHERE id = ?").get(id) as { description: string | null }).description,
  inTable: (db.prepare("SELECT description FROM job_descriptions WHERE job_id = ?").get(id) as { description: string } | undefined)?.description ?? null,
});

async function ingest(source: ReturnType<typeof fakeSource>, jobs: ReturnType<typeof rawJob>[], at: Date) {
  source.respond({ results: [{ feed: "acme", complete: true, jobs }], errors: [] });
  await runIngestion(db, [source], { staleAfterDays: 30, now: () => at });
}

describe("job descriptions", () => {
  it("are stored in job_descriptions, updated, and removed when a source drops them", async () => {
    const ats = fakeSource("ats");
    await ingest(ats, [rawJob({ externalId: "1", descriptionText: "Build APIs in Go." })], T0);
    expect(stored("ats:1")).toEqual({ inJobs: null, inTable: "Build APIs in Go." });

    await ingest(ats, [rawJob({ externalId: "1", descriptionText: "Build APIs in Rust." })], hoursLater(2));
    expect(stored("ats:1")).toEqual({ inJobs: null, inTable: "Build APIs in Rust." });

    await ingest(ats, [rawJob({ externalId: "1" })], hoursLater(4));
    expect(stored("ats:1")).toEqual({ inJobs: null, inTable: null });
  });

  it("are deleted with their role when old closed roles are pruned", async () => {
    const ats = fakeSource("ats");
    await ingest(ats, [rawJob({ externalId: "1", descriptionText: "Old role." }), rawJob({ externalId: "2", title: "Designer" })], T0);
    await ingest(ats, [rawJob({ externalId: "2", title: "Designer" })], hoursLater(2)); // role 1 closes
    pruneOldRows(db, new Date(T0.getTime() + 200 * 86_400_000), 90);
    expect(db.prepare("SELECT COUNT(*) AS n FROM job_descriptions").get()).toEqual({ n: 0 });
  });

  it("stored the old way are served the same, and move out of jobs once, keeping newer ones", async () => {
    const ats = fakeSource("ats");
    await ingest(ats, [1, 2, 3].map((n) => rawJob({ externalId: String(n), title: `Role ${n}` })), T0);
    // Rows as written before job_descriptions existed.
    const old = db.prepare("UPDATE jobs SET description = ? WHERE id = ?");
    old.run("Old text 1.", "ats:1");
    old.run("Old text 2.", "ats:2");
    old.run("Stale text 3.", "ats:3");
    db.prepare("INSERT INTO job_descriptions (job_id, description) VALUES ('ats:3', 'New text 3.')").run();

    const base = await serve();
    const detail = async (id: string) => ((await (await fetch(`${base}/api/jobs/${id}`)).json()) as { description: string }).description;
    expect(await detail("ats:1")).toBe("Old text 1.");
    expect(await detail("ats:3")).toBe("New text 3.");
    expect(findOpenJob(db, "ats:1")?.description).toBe("Old text 1.");

    // Batches stop at the batch size and carry on from the last row.
    const first = moveDescriptionsBatch(db, 0, 2);
    expect(first).toMatchObject({ moved: 2, done: false });
    expect(moveDescriptionsBatch(db, first.lastRowid, 2)).toMatchObject({ moved: 1, done: true });

    expect(stored("ats:1")).toEqual({ inJobs: null, inTable: "Old text 1." });
    expect(stored("ats:3")).toEqual({ inJobs: null, inTable: "New text 3." });
    expect(await detail("ats:1")).toBe("Old text 1.");
    expect(findOpenJob(db, "ats:3")?.description).toBe("New text 3.");

    const logs: string[] = [];
    expect(descriptionsMoved(db)).toBe(false);
    expect(await moveDescriptions(db, { pauseMs: 0, log: (m) => logs.push(m) })).toBe(0);
    expect(descriptionsMoved(db)).toBe(true);
    expect(logs).toEqual(["[db] moved 0 descriptions to job_descriptions"]);
    // Once done, later starts don't scan again.
    old.run("Written by an old version.", "ats:2");
    expect(await moveDescriptions(db, { pauseMs: 0, log: (m) => logs.push(m) })).toBe(0);
    expect(logs).toHaveLength(1);
  });
});

describe("stats cache", () => {
  it("serves the same numbers within the cache's lifetime, even after an ingestion", async () => {
    const ats = fakeSource("ats");
    await ingest(ats, [rawJob({ externalId: "1" })], T0);
    server = createApp(db).listen(0); // default 10-minute cache
    await new Promise((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const openJobs = async () => ((await (await fetch(`${base}/api/stats`)).json()) as { totals: { openJobs: number } }).totals.openJobs;
    expect(await openJobs()).toBe(1);

    // Even a finished ingestion doesn't recompute within the lifetime.
    await ingest(ats, [rawJob({ externalId: "1" }), rawJob({ externalId: "2", title: "Designer" })], hoursLater(2));
    expect(await openJobs()).toBe(1);
  });

  it("recomputes once the lifetime has passed", async () => {
    let clock = 0;
    const stats = cachedStats(db, 1000, () => clock);
    expect(stats().totals.openJobs).toBe(0);
    await ingest(fakeSource("ats"), [rawJob({ externalId: "1" })], T0);
    clock = 999;
    expect(stats().totals.openJobs).toBe(0);
    clock = 1000;
    expect(stats().totals.openJobs).toBe(1);
  });
});

describe("compactOnce", () => {
  it("compacts once after the move, only with enough free disk", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jr-compact-"));
    const file = path.join(dir, "db.sqlite");
    const fileDb = openDb(file);
    try {
      const logs: string[] = [];
      const log = (m: string) => logs.push(m);
      // Not before the move has finished.
      expect(compactOnce(fileDb, file, { log, freeBytes: () => Number.MAX_SAFE_INTEGER })).toBe(false);
      await moveDescriptions(fileDb, { pauseMs: 0, log: () => {} });

      expect(compactOnce(fileDb, file, { log, freeBytes: () => 1 })).toBe(false);
      expect(logs.at(-1)).toMatch(/not compacting: 0 MB free/);

      expect(compactOnce(fileDb, file, { log, freeBytes: () => Number.MAX_SAFE_INTEGER })).toBe(true);
      expect(logs.at(-1)).toMatch(/\[db\] compacted/);
      // Only once.
      expect(compactOnce(fileDb, file, { log, freeBytes: () => Number.MAX_SAFE_INTEGER })).toBe(false);
    } finally {
      fileDb.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
