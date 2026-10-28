import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { LIVENESS_USER_AGENT, livenessBudget, runLivenessCheck } from "../src/accuracy/liveness.js";
import { createAuditNet, type AuditNet } from "../src/accuracy/verify.js";
import { openDb, type Db } from "../src/db/index.js";
import { migrate } from "../src/db/schema.js";
import { retireStaleJobs, runIngestion, staleWindowsFor } from "../src/ingestion/pipeline.js";
import { startScheduler } from "../src/ingestion/scheduler.js";
import { fakeSource, rawJob } from "./helpers.js";

const T0 = new Date("2026-10-15T12:00:00Z");
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const ASHBY_A = "1c9c6d4e-1234-4abc-9def-0123456789ab";
const ASHBY_B = "2d9c6d4e-1234-4abc-9def-0123456789ab";

const gh = (id: string) => `https://boards-api.greenhouse.io/v1/boards/acme/jobs/${id}`;
const ASHBY_BOARD = "https://api.ashbyhq.com/posting-api/job-board/globex";

/** A fake net answering by exact URL (404 otherwise), recording URLs and User-Agents. */
function fakeNet(routes: Record<string, { status: number; body?: unknown }>, userAgent?: string): AuditNet & { calls: string[]; agents: string[] } {
  const calls: string[] = [];
  const agents: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    agents.push(new Headers(init?.headers).get("user-agent") ?? "");
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status });
  });
  return Object.assign(createAuditNet({ fetch: fetch as unknown as typeof globalThis.fetch, minGapMs: 0, userAgent }), { calls, agents });
}

interface Seeded {
  id: string;
  apply?: string;
}

/** Himalayas roles (an incomplete feed), each with an optional apply link. */
async function seed(db: Db, roles: Seeded[], source = "himalayas"): Promise<void> {
  const board = fakeSource(source, "aggregator");
  board.respond({
    results: [{ feed: "all", complete: false, jobs: roles.map((r) => rawJob({ externalId: r.id, title: `Role ${r.id}`, company: `Co ${r.id}` })) }],
    errors: [],
  });
  await runIngestion(db, [board], { staleAfterDays: 30, now: () => T0 });
  const setApply = db.prepare("UPDATE jobs SET apply_url = ? WHERE id = ?");
  for (const r of roles) if (r.apply) setApply.run(r.apply, `${source}:${r.id}`);
}

function state(db: Db, id: string) {
  return db.prepare("SELECT closed_at, closed_streak, last_verified_at FROM jobs WHERE id = ?").get(id) as {
    closed_at: string | null;
    closed_streak: number;
    last_verified_at: string | null;
  };
}

describe("liveness check", () => {
  it("checks only verifiable roles, oldest check first, within the request budget", async () => {
    const db = openDb(":memory:");
    await seed(db, [
      { id: "1", apply: "https://job-boards.greenhouse.io/acme/jobs/1" },
      { id: "2", apply: "https://job-boards.greenhouse.io/acme/jobs/2" },
      { id: "3", apply: "https://job-boards.greenhouse.io/acme/jobs/3" },
      { id: "4" }, // nothing to check it through
    ]);
    const routes = { [gh("1")]: { status: 200 }, [gh("2")]: { status: 200 }, [gh("3")]: { status: 200 } };

    const first = fakeNet(routes);
    const summary = await runLivenessCheck(db, first, { now: hoursLater(1), budget: 2 });
    expect(first.calls).toEqual([gh("1"), gh("2")]);
    expect(summary).toMatchObject({ checked: 2, requests: 2, open: 2 });
    expect(state(db, "himalayas:4").last_verified_at).toBeNull();

    // Never-checked role 3 goes first, then the oldest check.
    const second = fakeNet(routes);
    await runLivenessCheck(db, second, { now: hoursLater(2), budget: 2 });
    expect(second.calls).toEqual([gh("3"), gh("1")]);
  });

  it("counts one request per Ashby board, however many of its roles", async () => {
    const db = openDb(":memory:");
    await seed(db, [
      { id: "1", apply: `https://jobs.ashbyhq.com/globex/${ASHBY_A}` },
      { id: "2", apply: `https://jobs.ashbyhq.com/globex/${ASHBY_B}` },
      { id: "3", apply: "https://job-boards.greenhouse.io/acme/jobs/3" },
    ]);
    const net = fakeNet({ [ASHBY_BOARD]: { status: 200, body: { jobs: [{ id: ASHBY_A }, { id: ASHBY_B }] } } });
    const summary = await runLivenessCheck(db, net, { now: hoursLater(1), budget: 1 });
    expect(net.calls).toEqual([ASHBY_BOARD]);
    expect(summary).toMatchObject({ checked: 2, requests: 1, open: 2 });
  });

  it("closes a role only after two consecutive closed verdicts, then shows the copy it hid", async () => {
    const db = openDb(":memory:");
    await seed(db, [{ id: "1", apply: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
    // The same opening on a lower-ranked job board, hidden behind the Himalayas copy.
    const other = fakeSource("remotive", "aggregator");
    other.respond({ results: [{ feed: "all", complete: false, jobs: [rawJob({ externalId: "r1", title: "Role 1", company: "Co 1" })] }], errors: [] });
    await runIngestion(db, [other], { staleAfterDays: 30, now: () => T0 });
    const canonical = () => db.prepare("SELECT id FROM jobs WHERE canonical = 1 AND closed_at IS NULL").all();
    expect(canonical()).toEqual([{ id: "himalayas:1" }]);

    const gone = fakeNet({});
    await runLivenessCheck(db, gone, { now: hoursLater(1), budget: 10 });
    expect(state(db, "himalayas:1")).toMatchObject({ closed_at: null, closed_streak: 1 });

    // An open verdict resets the streak.
    await runLivenessCheck(db, fakeNet({ [gh("1")]: { status: 200 } }), { now: hoursLater(2), budget: 10 });
    expect(state(db, "himalayas:1")).toMatchObject({ closed_at: null, closed_streak: 0 });

    await runLivenessCheck(db, gone, { now: hoursLater(3), budget: 10 });
    const summary = await runLivenessCheck(db, gone, { now: hoursLater(4), budget: 10 });
    expect(summary.retired).toBe(1);
    expect(state(db, "himalayas:1")).toMatchObject({ closed_at: hoursLater(4).toISOString(), closed_streak: 2 });
    expect(canonical()).toEqual([{ id: "remotive:r1" }]);
  });

  it("ignores unknown verdicts either way", async () => {
    const db = openDb(":memory:");
    await seed(db, [{ id: "1", apply: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
    await runLivenessCheck(db, fakeNet({}), { now: hoursLater(1), budget: 10 });
    const summary = await runLivenessCheck(db, fakeNet({ [gh("1")]: { status: 503 } }), { now: hoursLater(2), budget: 10 });
    expect(summary).toMatchObject({ checked: 1, unknown: 1, retired: 0 });
    expect(state(db, "himalayas:1")).toMatchObject({ closed_at: null, closed_streak: 1, last_verified_at: hoursLater(2).toISOString() });

    // The next closed verdict is still the second in a row.
    await runLivenessCheck(db, fakeNet({}), { now: hoursLater(3), budget: 10 });
    expect(state(db, "himalayas:1").closed_at).toBe(hoursLater(3).toISOString());
  });

  it("leaves other sources alone", async () => {
    const db = openDb(":memory:");
    await seed(db, [{ id: "1", apply: "https://job-boards.greenhouse.io/acme/jobs/1" }], "remotive");
    const net = fakeNet({});
    expect(await runLivenessCheck(db, net, { now: hoursLater(1), budget: 10 })).toMatchObject({ checked: 0 });
    expect(net.calls).toEqual([]);
  });

  it("keeps a role it closed closed when the job board still lists it", async () => {
    const db = openDb(":memory:");
    await seed(db, [{ id: "1", apply: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
    await runLivenessCheck(db, fakeNet({}), { now: hoursLater(1), budget: 10 });
    await runLivenessCheck(db, fakeNet({}), { now: hoursLater(2), budget: 10 });
    await seed(db, [{ id: "1" }]);
    expect(state(db, "himalayas:1").closed_at).toBe(hoursLater(2).toISOString());
  });

  it("accrues the hourly budget since the last check, at most one hour's worth", async () => {
    const db = openDb(":memory:");
    expect(livenessBudget(db, T0, 300)).toBe(300);
    expect(livenessBudget(db, T0, 0)).toBe(0);
    await seed(db, [{ id: "1", apply: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
    await runLivenessCheck(db, fakeNet({}), { now: T0, budget: 10 });
    expect(livenessBudget(db, new Date(T0.getTime() + 20 * 60_000), 300)).toBe(100);
    expect(livenessBudget(db, hoursLater(5), 300)).toBe(300);
  });
});

describe("per-source stale window", () => {
  it("retires job-board roles after their own window, and verified ones after the default", async () => {
    const db = openDb(":memory:");
    await seed(db, [{ id: "1" }, { id: "2", apply: "https://job-boards.greenhouse.io/acme/jobs/2" }]);
    const ats = fakeSource("greenhouse");
    ats.respond({ results: [{ feed: "acme", complete: false, jobs: [rawJob({ externalId: "9", company: "Acme" })] }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    await runLivenessCheck(db, fakeNet({ [gh("2")]: { status: 200 } }), { now: hoursLater(1), budget: 10 });

    const windows = staleWindowsFor([fakeSource("himalayas", "aggregator"), ats], 30, 14);
    expect(windows).toEqual({ defaultDays: 30, bySource: { himalayas: 14 } });
    const open = () => (db.prepare("SELECT id FROM jobs WHERE closed_at IS NULL ORDER BY id").all() as { id: string }[]).map((r) => r.id);

    retireStaleJobs(db, hoursLater(13 * 24), windows);
    expect(open()).toEqual(["greenhouse:9", "himalayas:1", "himalayas:2"]);
    retireStaleJobs(db, hoursLater(15 * 24), windows);
    expect(open()).toEqual(["greenhouse:9", "himalayas:2"]);
    retireStaleJobs(db, hoursLater(31 * 24), windows);
    expect(open()).toEqual([]);
  });

  it("still accepts a single window for every source", async () => {
    const db = openDb(":memory:");
    await seed(db, [{ id: "1" }]);
    expect(retireStaleJobs(db, hoursLater(15 * 24), 30)).toBe(0);
    expect(retireStaleJobs(db, hoursLater(31 * 24), 30)).toBe(1);
  });
});

describe("liveness migration", () => {
  it("adds last_verified_at and closed_streak to an existing database", () => {
    const raw = new Database(":memory:");
    migrate(raw);
    const columns = (raw.prepare("PRAGMA table_info(jobs)").all() as { name: string; dflt_value: string | null }[]).filter((c) =>
      ["last_verified_at", "closed_streak"].includes(c.name),
    );
    expect(columns).toEqual([
      expect.objectContaining({ name: "last_verified_at", dflt_value: null }),
      expect.objectContaining({ name: "closed_streak", dflt_value: "0" }),
    ]);
    expect(raw.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(4);
    // Re-running is a no-op.
    migrate(raw);
    expect(raw.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(4);
  });
});

describe("liveness scheduler wiring", () => {
  const base = { tickMinutes: 60, staleAfterDays: 30, ingestIntervalHours: 12, pruneAfterDays: 0 };

  it("runs a check each tick with the accrued budget", async () => {
    const db = openDb(":memory:");
    await seed(db, [{ id: "1", apply: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
    const net = fakeNet({ [gh("1")]: { status: 200 } }, LIVENESS_USER_AGENT);
    const runLiveness = vi.fn((d: Db, now: Date, budget: number) => runLivenessCheck(d, net, { now, budget }));

    const first = startScheduler(db, [], { ...base, livenessRequestsPerHour: 300, runLiveness });
    await first.idle();
    first.stop();
    expect(runLiveness).toHaveBeenCalledTimes(1);
    expect(runLiveness.mock.calls[0]?.[2]).toBe(300);
    expect(net.calls).toEqual([gh("1")]);
    expect(net.agents).toEqual([LIVENESS_USER_AGENT]);

    // A restart right after has (almost) nothing left to spend.
    const second = startScheduler(db, [], { ...base, livenessRequestsPerHour: 300, runLiveness });
    await second.idle();
    second.stop();
    expect(runLiveness).toHaveBeenCalledTimes(1);
  });

  it("never checks when disabled", async () => {
    const db = openDb(":memory:");
    const runLiveness = vi.fn();
    const scheduler = startScheduler(db, [], { ...base, livenessRequestsPerHour: 0, runLiveness });
    await scheduler.idle();
    scheduler.stop();
    expect(runLiveness).not.toHaveBeenCalled();
  });
});
