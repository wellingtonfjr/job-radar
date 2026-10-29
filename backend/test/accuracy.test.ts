import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { isAuditDue, runAccuracyAudit } from "../src/accuracy/audit.js";
import { countVerdicts, coverage, falseClosureRate, openPrecision, percentile, ratio } from "../src/accuracy/metrics.js";
import { AUDIT_USER_AGENT, createAuditNet, createVerifier, himalayasRef, parsePostingRef, refFromAtsRow, type AuditNet } from "../src/accuracy/verify.js";
import { getAccuracy } from "../src/api/accuracy.js";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { startScheduler } from "../src/ingestion/scheduler.js";
import { fakeSource, rawJob } from "./helpers.js";

const LEVER_ID = "0b9c6d4e-1234-4abc-9def-0123456789ab";
const ASHBY_ID = "1c9c6d4e-1234-4abc-9def-0123456789ab";
const ASHBY_GONE = "2d9c6d4e-1234-4abc-9def-0123456789ab";

/** A fake fetch answering by exact URL (404 for anything else), recording calls. */
function fakeFetch(routes: Record<string, { status: number; body?: unknown } | "network-error">) {
  const calls: { url: string; userAgent: string | null }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, userAgent: new Headers(init?.headers).get("user-agent") });
    const route = routes[url];
    if (route === "network-error") throw new TypeError("fetch failed");
    if (!route) return new Response("not found", { status: 404 });
    return new Response(typeof route.body === "string" ? route.body : JSON.stringify(route.body ?? {}), { status: route.status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

/** A fake AuditNet over exact URLs; anything else is a 404. */
function fakeNet(routes: Record<string, { status: number; body?: unknown }>): AuditNet & { calls: string[] } {
  const { fetch, calls } = fakeFetch(routes);
  const net = createAuditNet({ fetch, minGapMs: 0 });
  return Object.assign(net, {
    get calls() {
      return calls.map((c) => c.url);
    },
  });
}

describe("posting refs", () => {
  it("parses Greenhouse, Lever and Ashby posting URLs", () => {
    expect(parsePostingRef("https://job-boards.greenhouse.io/acme/jobs/123456?gh_src=x")).toEqual({ provider: "greenhouse", board: "acme", id: "123456" });
    expect(parsePostingRef("https://boards.greenhouse.io/acme/jobs/42")).toEqual({ provider: "greenhouse", board: "acme", id: "42" });
    expect(parsePostingRef(`https://jobs.lever.co/acme/${LEVER_ID}/apply`)).toEqual({ provider: "lever", board: "acme", id: LEVER_ID });
    expect(parsePostingRef(`https://jobs.eu.lever.co/acme/${LEVER_ID}`)).toEqual({ provider: "lever", board: "acme", id: LEVER_ID, eu: true });
    expect(parsePostingRef(`https://jobs.ashbyhq.com/Acme%20Inc/${ASHBY_ID.toUpperCase()}`)).toEqual({ provider: "ashby", board: "Acme Inc", id: ASHBY_ID });
  });

  it("returns null for anything that can't be checked through an ATS API", () => {
    expect(parsePostingRef(null)).toBeNull();
    expect(parsePostingRef("https://acme.com/careers?gh_jid=42")).toBeNull();
    expect(parsePostingRef("https://jobs.lever.co/acme")).toBeNull();
    expect(parsePostingRef("https://himalayas.app/companies/acme/jobs/engineer")).toBeNull();
    expect(parsePostingRef("https://apply.workable.com/acme/j/ABC123/")).toBeNull();
  });

  it("builds refs for rows ingested from an ATS only", () => {
    expect(refFromAtsRow("lever", "acme", LEVER_ID)).toEqual({ provider: "lever", board: "acme", id: LEVER_ID });
    expect(refFromAtsRow("remotive", "all", "1")).toBeNull();
    expect(refFromAtsRow("inhire", "acme", "1")).toBeNull();
  });

  it("builds Himalayas refs from the posting URL, without its query", () => {
    expect(himalayasRef("himalayas", "https://himalayas.app/companies/dualentry/jobs/frontend-software-engineer-mid-level-7781816248?utm_source=api")).toEqual({
      provider: "himalayas",
      board: "dualentry",
      id: "https://himalayas.app/companies/dualentry/jobs/frontend-software-engineer-mid-level-7781816248",
    });
    expect(himalayasRef("himalayas", "1")).toBeNull();
    expect(himalayasRef("jobicy", "https://himalayas.app/companies/acme/jobs/x")).toBeNull();
  });
});

describe("verifier", () => {
  it("classifies Greenhouse and Lever by status: 200 open, 404 closed, else unknown", async () => {
    const { fetch, calls } = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1": { status: 200, body: { id: 1 } },
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/3": { status: 503 },
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4": "network-error",
      [`https://api.lever.co/v0/postings/acme/${LEVER_ID}`]: { status: 200 },
      [`https://api.eu.lever.co/v0/postings/acme/${LEVER_ID}`]: { status: 403 },
    });
    const verify = createVerifier(createAuditNet({ fetch, minGapMs: 0 }));
    expect(await verify({ provider: "greenhouse", board: "acme", id: "1" })).toBe("open");
    expect(await verify({ provider: "greenhouse", board: "acme", id: "2" })).toBe("closed");
    expect(await verify({ provider: "greenhouse", board: "acme", id: "3" })).toBe("unknown");
    expect(await verify({ provider: "greenhouse", board: "acme", id: "4" })).toBe("unknown");
    expect(await verify({ provider: "lever", board: "acme", id: LEVER_ID })).toBe("open");
    expect(await verify({ provider: "lever", board: "acme", id: LEVER_ID, eu: true })).toBe("unknown");
    expect(await verify({ provider: "lever", board: "gone", id: LEVER_ID })).toBe("closed");
    expect(calls.every((c) => c.userAgent === AUDIT_USER_AGENT)).toBe(true);
  });

  it("looks Ashby postings up in the board list, fetched once per board", async () => {
    const { fetch, calls } = fakeFetch({
      "https://api.ashbyhq.com/posting-api/job-board/acme": {
        status: 200,
        body: { jobs: [{ id: ASHBY_ID.toUpperCase(), isListed: true }, { id: ASHBY_GONE, isListed: false }] },
      },
      "https://api.ashbyhq.com/posting-api/job-board/broken": { status: 200, body: "<html>not json" },
    });
    const verify = createVerifier(createAuditNet({ fetch, minGapMs: 0 }));
    expect(await verify({ provider: "ashby", board: "acme", id: ASHBY_ID })).toBe("open");
    expect(await verify({ provider: "ashby", board: "acme", id: ASHBY_GONE })).toBe("closed");
    expect(await verify({ provider: "ashby", board: "acme", id: LEVER_ID })).toBe("closed");
    // A board we can't read says nothing about its postings.
    expect(await verify({ provider: "ashby", board: "missing", id: ASHBY_ID })).toBe("unknown");
    expect(await verify({ provider: "ashby", board: "broken", id: ASHBY_ID })).toBe("unknown");
    expect(calls.filter((c) => c.url.endsWith("/acme"))).toHaveLength(1);
  });

  it("spaces requests to the same host", async () => {
    const { fetch } = fakeFetch({});
    const net = createAuditNet({ fetch, minGapMs: 40 });
    const started = Date.now();
    await Promise.all([net.get("https://a.example/1"), net.get("https://a.example/2"), net.get("https://b.example/1")]);
    // Two requests to a.example: the second waits one gap; b.example doesn't.
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(Date.now() - started).toBeLessThan(80);
  });
});

describe("metrics", () => {
  it("counts verdicts and leaves unknowns out of the rates", () => {
    const c = countVerdicts(["open", "open", "open", "closed", "unknown"]);
    expect(c).toEqual({ sampled: 5, open: 3, closed: 1, unknown: 1 });
    expect(openPrecision(c)).toBe(0.75);
    expect(falseClosureRate(countVerdicts(["open", "closed", "closed", "closed"]))).toBe(0.25);
    expect(coverage(c, countVerdicts(["unknown", "closed"]))).toBe(5 / 7);
  });

  it("is null, not 0% or 100%, when nothing was measured", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(openPrecision(countVerdicts(["unknown"]))).toBeNull();
    expect(coverage(countVerdicts([]), countVerdicts([]))).toBeNull();
    expect(percentile([], 50)).toBeNull();
  });

  it("computes nearest-rank percentiles", () => {
    const hours = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(hours, 50)).toBe(5);
    expect(percentile(hours, 90)).toBe(9);
    expect(percentile(hours, 100)).toBe(10);
    expect(percentile([12], 90)).toBe(12);
  });
});

/** Greenhouse board "acme" with 3 open roles + 1 recently closed, Lever with 1, and a job board. */
async function seed(): Promise<Db> {
  const db = openDb(":memory:");
  const now = Date.now();
  const at = (hoursAgo: number) => () => new Date(now - hoursAgo * 3_600_000);

  const greenhouse = fakeSource("greenhouse");
  const jobs = ["1", "2", "3", "4"].map((id) => rawJob({ externalId: id, title: `Engineer ${id}` }));
  greenhouse.respond({ results: [{ feed: "acme", complete: true, jobs }], errors: [] });
  await runIngestion(db, [greenhouse], { staleAfterDays: 30, now: at(24) });
  // Role 4 leaves the board: closed 12h later.
  greenhouse.respond({ results: [{ feed: "acme", complete: true, jobs: jobs.slice(0, 3) }], errors: [] });
  await runIngestion(db, [greenhouse], { staleAfterDays: 30, force: true, now: at(12) });

  const lever = fakeSource("lever");
  lever.respond({ results: [{ feed: "globex", complete: true, jobs: [rawJob({ externalId: LEVER_ID, company: "Globex", title: "Designer" })] }], errors: [] });
  await runIngestion(db, [lever], { staleAfterDays: 30 });

  const board = fakeSource("himalayas", "aggregator");
  board.respond({
    results: [
      {
        feed: "all",
        complete: true,
        jobs: [
          rawJob({ externalId: "h1", company: "Initech", title: "Analyst", url: "https://himalayas.app/jobs/h1" }),
          rawJob({ externalId: "h2", company: "Hooli", title: "Writer", url: "https://himalayas.app/jobs/h2" }),
        ],
      },
    ],
    errors: [],
  });
  await runIngestion(db, [board], { staleAfterDays: 30 });
  db.prepare("UPDATE jobs SET apply_url = ? WHERE id = 'himalayas:h1'").run("https://job-boards.greenhouse.io/initech/jobs/77");
  return db;
}

const AUDIT_ROUTES = {
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1": { status: 200 },
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs/2": { status: 200 },
  // 3 is shown as open but gone upstream (404 by default).
  // 4 was closed but is still open upstream: a false closure.
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4": { status: 200 },
  [`https://api.lever.co/v0/postings/globex/${LEVER_ID}`]: { status: 429 },
  "https://boards-api.greenhouse.io/v1/boards/initech/jobs/77": { status: 200 },
};

describe("accuracy audit", () => {
  it("samples per source, verifies through the ATS and records the run", async () => {
    const db = await seed();
    const net = fakeNet(AUDIT_ROUTES);
    const summary = await runAccuracyAudit(db, net, { now: new Date() });

    const by = Object.fromEntries(summary.sources.map((s) => [s.source, s]));
    expect(by.greenhouse).toMatchObject({
      kind: "ats",
      open: { sampled: 3, open: 2, closed: 1, unknown: 0 },
      closed: { sampled: 1, open: 1, closed: 0, unknown: 0 },
      latency: { count: 1, p50Hours: 12, p90Hours: 12 },
      mismatches: { shownOpenButClosed: ["greenhouse:3"], closedButStillOpen: ["greenhouse:4"] },
    });
    expect(by.lever).toMatchObject({ open: { sampled: 1, open: 0, closed: 0, unknown: 1 } });
    // h1 is checked through its Greenhouse apply link; h2 has nothing checkable.
    expect(by.himalayas).toMatchObject({ kind: "aggregator", open: { sampled: 2, open: 1, closed: 0, unknown: 1 } });
    // Job-board pages are never fetched.
    expect(net.calls.some((u) => u.includes("himalayas.app"))).toBe(false);

    const report = getAccuracy(db);
    expect(report.run).toMatchObject({ id: summary.runId });
    const gh = report.sources.find((s) => s.source === "greenhouse");
    expect(gh).toMatchObject({ open: { verified: 3, precision: 2 / 3 }, closed: { verified: 1, falseClosureRate: 1 }, coverage: 1 });
    expect(report.sources.find((s) => s.source === "lever")).toMatchObject({ open: { precision: null }, coverage: 0 });
  });

  it("draws job-board rows until enough are checkable, capped by maxDraw", async () => {
    const db = await seed();
    const summary = await runAccuracyAudit(db, fakeNet(AUDIT_ROUTES), { now: new Date(), openSample: 1, maxDraw: 1 });
    const himalayas = summary.sources.find((s) => s.source === "himalayas");
    expect(himalayas?.open.sampled).toBe(1);
  });

  it("records a failed run and rethrows", async () => {
    const db = await seed();
    db.exec("DROP TABLE accuracy_results");
    await expect(runAccuracyAudit(db, fakeNet(AUDIT_ROUTES), { now: new Date() })).rejects.toThrow();
    expect(db.prepare("SELECT status FROM accuracy_runs").get()).toEqual({ status: "failed" });
  });
});

describe("GET /api/accuracy", () => {
  async function get(db: Db) {
    const server = createApp(db).listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accuracy`);
      return { status: res.status, body: (await res.json()) as any };
    } finally {
      server.close();
    }
  }

  it("says no audit has run yet", async () => {
    expect(await get(openDb(":memory:"))).toEqual({ status: 200, body: { run: null, summary: { verified: 0, openPrecision: null }, sources: [] } });
  });

  it("returns the latest successful run", async () => {
    const db = await seed();
    await runAccuracyAudit(db, fakeNet(AUDIT_ROUTES), { now: new Date() });
    const latest = await runAccuracyAudit(db, fakeNet({ ...AUDIT_ROUTES, "https://boards-api.greenhouse.io/v1/boards/acme/jobs/3": { status: 200 } }), {
      now: new Date(),
    });
    db.prepare("INSERT INTO accuracy_runs (started_at, status) VALUES (?, 'failed')").run(new Date().toISOString());

    const { status, body } = await get(db);
    expect(status).toBe(200);
    expect(body.run.id).toBe(latest.runId);
    expect(body.sources.find((s: any) => s.source === "greenhouse")).toMatchObject({
      kind: "ats",
      open: { sampled: 3, open: 3, closed: 0, unknown: 0, verified: 3, precision: 1 },
      closed: { sampled: 1, open: 1, verified: 1, falseClosureRate: 1 },
      latency: { count: 1, p50Hours: 12, p90Hours: 12 },
      coverage: 1,
    });
  });
});

describe("scheduler wiring", () => {
  it("is due before the first audit and again after the interval", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-10-28T12:00:00Z");
    expect(isAuditDue(db, now, 7)).toBe(true);
    db.prepare("INSERT INTO accuracy_runs (started_at, status) VALUES (?, 'failed')").run("2026-10-22T12:00:00.000Z");
    expect(isAuditDue(db, now, 7)).toBe(false);
    expect(isAuditDue(db, new Date("2026-10-29T12:00:00Z"), 7)).toBe(true);
  });

  it("runs the audit after the ingestion cycle when due, and not again until the next interval", async () => {
    const db = openDb(":memory:");
    const runAudit = vi.fn((d: Db, now: Date) => runAccuracyAudit(d, fakeNet({}), { now, sources: [] }));
    const options = { tickMinutes: 60, staleAfterDays: 30, ingestIntervalHours: 12, pruneAfterDays: 0, accuracyAuditDays: 7, runAudit };

    const first = startScheduler(db, [], options);
    await first.idle();
    first.stop();
    expect(runAudit).toHaveBeenCalledTimes(1);

    // A restart (e.g. a deploy) right after doesn't audit again.
    const second = startScheduler(db, [], options);
    await second.idle();
    second.stop();
    expect(runAudit).toHaveBeenCalledTimes(1);
  });

  it("never audits when disabled", async () => {
    const db = openDb(":memory:");
    const runAudit = vi.fn();
    const scheduler = startScheduler(db, [], { tickMinutes: 60, staleAfterDays: 30, ingestIntervalHours: 12, pruneAfterDays: 0, accuracyAuditDays: 0, runAudit });
    await scheduler.idle();
    scheduler.stop();
    expect(runAudit).not.toHaveBeenCalled();
  });
});
