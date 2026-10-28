import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAccuracyAudit } from "../src/accuracy/audit.js";
import { checkRole, livenessBudget, runLivenessCheck } from "../src/accuracy/liveness.js";
import { DEV_REPORT_IP_SALT, hashIp, recordReport, REPORTS_TO_HIDE } from "../src/accuracy/reports.js";
import { createAuditNet, type AuditNet } from "../src/accuracy/verify.js";
import { getAccuracy, MIN_VERIFIED_FOR_SUMMARY } from "../src/api/accuracy.js";
import { createReportQueue, type ReportQueue } from "../src/api/reports.js";
import { createApp, type AppOptions } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";
import { recomputeCanonical, runIngestion } from "../src/ingestion/pipeline.js";
import { fakeSource, rawJob } from "./helpers.js";

const gh = (id: string) => `https://boards-api.greenhouse.io/v1/boards/acme/jobs/${id}`;

/** A fake net answering by exact URL (404 otherwise), recording the URLs asked for. */
function fakeNet(routes: Record<string, number>): AuditNet & { calls: string[] } {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const status = routes[url];
    return status ? new Response("{}", { status }) : new Response("not found", { status: 404 });
  });
  return Object.assign(createAuditNet({ fetch: fetch as unknown as typeof globalThis.fetch, minGapMs: 0 }), { calls });
}

/**
 * Himalayas roles 1-3 with Greenhouse apply links (checkable), and role 4
 * with none, seen `hoursAgo` before now.
 */
async function seed(hoursAgo = 2): Promise<Db> {
  const db = openDb(":memory:");
  const board = fakeSource("himalayas", "aggregator");
  board.respond({
    results: [{ feed: "all", complete: false, jobs: ["1", "2", "3", "4"].map((id) => rawJob({ externalId: id, title: `Role ${id}`, company: `Co ${id}` })) }],
    errors: [],
  });
  await runIngestion(db, [board], { staleAfterDays: 30, now: () => new Date(Date.now() - hoursAgo * 3_600_000) });
  const setApply = db.prepare("UPDATE jobs SET apply_url = ? WHERE id = ?");
  for (const id of ["1", "2", "3"]) setApply.run(`https://job-boards.greenhouse.io/acme/jobs/${id}`, `himalayas:${id}`);
  return db;
}

const job = (db: Db, id: string) =>
  db.prepare("SELECT canonical, closed_at, closed_streak, last_verified_at FROM jobs WHERE id = ?").get(id) as {
    canonical: number;
    closed_at: string | null;
    closed_streak: number;
    last_verified_at: string | null;
  };
const reports = (db: Db, id: string) =>
  db.prepare("SELECT ip_hash, verdict FROM job_reports WHERE job_id = ? ORDER BY id").all(id) as { ip_hash: string; verdict: string | null }[];

let servers: Server[] = [];
afterEach(() => {
  servers.forEach((s) => s.close());
  servers = [];
});

function serve(db: Db, options: AppOptions = {}) {
  const server = createApp(db, options).listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    report: (id: string, ip: string, init: RequestInit = {}) =>
      fetch(`${base}/api/jobs/${encodeURIComponent(id)}/report`, {
        method: "POST",
        ...init,
        headers: { "Content-Type": "application/json", "Fly-Client-IP": ip, ...(init.headers as Record<string, string>) },
        body: "{}",
      }),
    get: async (path: string) => (await fetch(`${base}${path}`)).json() as Promise<any>,
  };
}

describe("POST /api/jobs/:id/report", () => {
  it("records the report under a hashed IP and queues a check", async () => {
    const db = await seed();
    const enqueue = vi.fn();
    const queue: ReportQueue = { enqueue, idle: () => Promise.resolve() };
    const api = serve(db, { reportQueue: queue, reportIpSalt: "s3cret" });

    const res = await api.report("himalayas:1", "203.0.113.7");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "checking" });
    expect(enqueue).toHaveBeenCalledWith("himalayas:1");

    const [row] = reports(db, "himalayas:1");
    expect(row).toEqual({ ip_hash: hashIp("203.0.113.7", "s3cret"), verdict: null });
    // The raw IP is stored nowhere, and the salt matters.
    expect(JSON.stringify(db.prepare("SELECT * FROM job_reports").all())).not.toContain("203.0.113.7");
    expect(row?.ip_hash).not.toBe(hashIp("203.0.113.7", DEV_REPORT_IP_SALT));
  });

  it("takes one report per visitor and role per week", async () => {
    const db = await seed();
    const enqueue = vi.fn();
    const api = serve(db, { reportQueue: { enqueue, idle: () => Promise.resolve() } });
    await api.report("himalayas:1", "203.0.113.7");
    const again = await api.report("himalayas:1", "203.0.113.7");
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ status: "already-reported" });
    expect(reports(db, "himalayas:1")).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an unknown role and doesn't record reports on closed ones", async () => {
    const db = await seed();
    db.prepare("UPDATE jobs SET closed_at = ? WHERE id = 'himalayas:2'").run(new Date().toISOString());
    const api = serve(db);
    expect((await api.report("himalayas:nope", "203.0.113.7")).status).toBe(404);
    const closed = await api.report("himalayas:2", "203.0.113.7");
    expect(await closed.json()).toEqual({ status: "closed" });
    expect(reports(db, "himalayas:2")).toEqual([]);
  });

  it("refuses reports that aren't JSON or come from another site", async () => {
    const db = await seed();
    const api = serve(db);
    const form = await api.report("himalayas:1", "203.0.113.7", { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
    const crossSite = await api.report("himalayas:1", "203.0.113.7", { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(crossSite.status).toBe(415);
    expect(reports(db, "himalayas:1")).toEqual([]);
  });

  it("limits reports per visitor per hour", async () => {
    const db = await seed();
    const api = serve(db, { reportsPerHour: 2 });
    expect((await api.report("himalayas:1", "203.0.113.7")).status).toBe(202);
    expect((await api.report("himalayas:2", "203.0.113.7")).status).toBe(202);
    const blocked = await api.report("himalayas:3", "203.0.113.7");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many reports, please try again later." });
    // Another visitor still can.
    expect((await api.report("himalayas:3", "198.51.100.9")).status).toBe(202);
  });
});

describe("hiding reported roles", () => {
  const listed = async (api: ReturnType<typeof serve>) => ((await api.get("/api/jobs")).jobs as { id: string }[]).map((j) => j.id).sort();

  it(`hides a role from the default listing at ${REPORTS_TO_HIDE} reports from distinct visitors`, async () => {
    const db = await seed();
    const api = serve(db);
    await api.report("himalayas:4", "203.0.113.1");
    await api.report("himalayas:4", "203.0.113.2");
    expect(await listed(api)).toContain("himalayas:4");
    await api.report("himalayas:4", "203.0.113.3");
    expect(await listed(api)).not.toContain("himalayas:4");
    // Still open: its page and its source's own listing show it.
    expect((await api.get("/api/jobs/himalayas%3A4")).closedAt).toBeNull();
    expect(((await api.get("/api/jobs?source=himalayas")).jobs as { id: string }[]).map((j) => j.id)).toContain("himalayas:4");
    // And it stays hidden when ingestion recomputes the listing.
    recomputeCanonical(db, new Date());
    expect(job(db, "himalayas:4").canonical).toBe(0);
  });

  it("counts an IPv6 visitor's /56 once", async () => {
    const db = await seed();
    const api = serve(db);
    await api.report("himalayas:4", "2001:db8:aa:bb01::1");
    await api.report("himalayas:4", "2001:db8:aa:bb02::1");
    await api.report("himalayas:4", "2001:db8:aa:bb03::1");
    expect(reports(db, "himalayas:4")).toHaveLength(1);
    expect(job(db, "himalayas:4").canonical).toBe(1);
  });

  it("shows the role again once the reports are a week old", () => {
    return seed().then((db) => {
      const then = new Date(Date.now() - 8 * 86_400_000);
      for (const ip of ["a", "b", "c"]) recordReport(db, "himalayas:4", ip, then);
      recomputeCanonical(db, new Date(then.getTime() + 60_000));
      expect(job(db, "himalayas:4").canonical).toBe(0);
      recomputeCanonical(db, new Date());
      expect(job(db, "himalayas:4").canonical).toBe(1);
    });
  });
});

describe("liveness check on report", () => {
  it("keeps the reports when the ATS can't answer", async () => {
    const db = await seed();
    const net = fakeNet({ [gh("1")]: 503 });
    const queue = createReportQueue(db, net);
    const api = serve(db, { reportQueue: queue });
    for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) await api.report("himalayas:1", ip);
    await queue.idle();

    // One check for the three reports, whose answer was "unknown".
    expect(net.calls).toEqual([gh("1")]);
    expect(reports(db, "himalayas:1").map((r) => r.verdict)).toEqual(["unknown", null, null]);
    expect(job(db, "himalayas:1")).toMatchObject({ canonical: 0, closed_at: null });
  });

  it("dismisses the reports when the ATS says the role is open", async () => {
    const db = await seed();
    for (const ip of ["a", "b", "c"]) recordReport(db, "himalayas:1", ip, new Date());
    expect(job(db, "himalayas:1").canonical).toBe(0);

    expect(await checkRole(db, fakeNet({ [gh("1")]: 200 }), "himalayas:1", new Date())).toBe("open");
    expect(reports(db, "himalayas:1").map((r) => r.verdict)).toEqual(["open", "open", "open"]);
    expect(job(db, "himalayas:1")).toMatchObject({ canonical: 1, closed_streak: 0 });
  });

  it("never closes a role on one report: a second 'closed' must come an hour later", async () => {
    const db = await seed();
    const net = fakeNet({});
    const queue = createReportQueue(db, net);
    const api = serve(db, { reportQueue: queue });

    await api.report("himalayas:2", "203.0.113.1");
    await queue.idle();
    expect(job(db, "himalayas:2")).toMatchObject({ closed_at: null, closed_streak: 1 });
    expect(reports(db, "himalayas:2")[0]?.verdict).toBe("closed");

    // Another report right away doesn't trigger another request.
    await api.report("himalayas:2", "203.0.113.2");
    await queue.idle();
    expect(net.calls).toEqual([gh("2")]);
    expect(job(db, "himalayas:2")).toMatchObject({ closed_at: null, closed_streak: 1 });

    // An hour later, the ATS still says closed: the liveness rule closes it.
    const later = new Date(Date.now() + 3_600_000 + 1000);
    expect(await checkRole(db, net, "himalayas:2", later)).toBe("closed");
    expect(job(db, "himalayas:2").closed_at).toBe(later.toISOString());
  });

  it("doesn't check roles with no ATS posting to check through", async () => {
    const db = await seed();
    const net = fakeNet({});
    expect(await checkRole(db, net, "himalayas:4", new Date())).toBeNull();
    expect(net.calls).toEqual([]);
  });

  it("doesn't eat into the hourly liveness budget", async () => {
    const db = await seed();
    const now = new Date();
    await runLivenessCheck(db, fakeNet({}), { now, budget: 1 });
    const soon = new Date(now.getTime() + 30 * 60_000);
    expect(livenessBudget(db, soon, 300)).toBe(150);
    await checkRole(db, fakeNet({ [gh("3")]: 200 }), "himalayas:3", new Date(now.getTime() + 20 * 60_000));
    expect(livenessBudget(db, soon, 300)).toBe(150);
  });
});

describe("freshness and audit", () => {
  it("exposes when each role was last checked", async () => {
    const db = await seed();
    const api = serve(db);
    const before = await api.get("/api/jobs/himalayas%3A1");
    expect(before.lastVerifiedAt).toBeNull();
    expect(before.checkedAt).toBe(before.lastSeenAt);

    const now = new Date();
    await checkRole(db, fakeNet({ [gh("1")]: 200 }), "himalayas:1", now);
    const after = await api.get("/api/jobs/himalayas%3A1");
    expect(after.lastVerifiedAt).toBe(now.toISOString());
    expect(after.checkedAt).toBe(now.toISOString());
    expect(((await api.get("/api/jobs")).jobs as { id: string; checkedAt: string }[]).find((j) => j.id === "himalayas:1")?.checkedAt).toBe(
      now.toISOString(),
    );
  });

  it("counts reports per source in the audit", async () => {
    const db = await seed();
    recordReport(db, "himalayas:1", "a", new Date());
    recordReport(db, "himalayas:2", "a", new Date());
    recordReport(db, "himalayas:2", "b", new Date(Date.now() - 10 * 86_400_000));
    const summary = await runAccuracyAudit(db, fakeNet({}), { now: new Date(), sources: [fakeSource("himalayas", "aggregator")] });
    expect(summary.sources[0]?.reports).toBe(2);
    expect(getAccuracy(db).sources[0]?.reports).toBe(2);
  });

  it(`summarizes open precision only from ${MIN_VERIFIED_FOR_SUMMARY} verified roles in a recent run`, () => {
    const db = openDb(":memory:");
    const now = new Date("2026-10-28T12:00:00Z");
    const addRun = (finishedAt: string, open: number, closed: number) => {
      const id = db.prepare("INSERT INTO accuracy_runs (started_at, finished_at, status) VALUES (?, ?, 'ok')").run(finishedAt, finishedAt).lastInsertRowid;
      for (const [source, share] of [["greenhouse", 0.5], ["lever", 0.5]] as const) {
        db.prepare(
          `INSERT INTO accuracy_results (run_id, source, kind, open_sampled, open_open, open_closed, open_unknown,
             closed_sampled, closed_open, closed_closed, closed_unknown, latency_count)
           VALUES (?, ?, 'ats', ?, ?, ?, 5, 0, 0, 0, 0, 0)`,
        ).run(id, source, open * share + closed * share + 5, open * share, closed * share);
      }
    };
    addRun("2026-10-27T12:00:00.000Z", 20, 2);
    expect(getAccuracy(db, now).summary).toEqual({ verified: 22, openPrecision: null });
    addRun("2026-10-27T13:00:00.000Z", 38, 2);
    expect(getAccuracy(db, now).summary).toEqual({ verified: 40, openPrecision: 0.95 });
    // Too old to quote.
    expect(getAccuracy(db, new Date("2026-11-20T12:00:00Z")).summary.openPrecision).toBeNull();
  });
});
