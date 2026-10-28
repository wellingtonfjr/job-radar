import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { fakeSource, rawJob } from "./helpers.js";

let db: Db;
let server: Server;
let base: string;

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  db = openDb(":memory:");
  const ats = fakeSource("greenhouse");
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  ats.respond({
    results: [
      {
        feed: "acme",
        complete: true,
        jobs: [
          rawJob({ externalId: "1", title: "Senior Front-End Engineer", descriptionHtml: "<p>React, TypeScript</p>", salary: { min: 150_000, max: 180_000, currency: "USD", period: "year" }, postedAt: daysAgo(1) }),
          rawJob({ externalId: "2", title: "Product Designer", locations: ["Berlin, Germany"], workplace: "onsite", postedAt: daysAgo(3) }),
          rawJob({ externalId: "3", title: "Backend Engineer", locations: ["Remote - USA"], descriptionHtml: "<p>Go and Kafka. Python</p>", postedAt: daysAgo(20) }),
          rawJob({ externalId: "4", title: "Account Executive", locations: ["Remote, LATAM"], postedAt: daysAgo(2) }),
          // Evergreen: open on the board, but posted well over 180 days ago.
          rawJob({ externalId: "5", title: "Forward Deployed Engineer", postedAt: daysAgo(400) }),
        ],
      },
    ],
    errors: [],
  });
  await runIngestion(db, [ats], { staleAfterDays: 30 });

  // Two job-board listings: one with a resolved employer link, one without.
  const board = fakeSource("himalayas", "aggregator");
  board.respond({
    results: [
      {
        feed: "all",
        complete: true,
        jobs: [
          rawJob({ externalId: "b1", company: "Globex", title: "Data Analyst", url: "https://himalayas.app/jobs/b1", postedAt: daysAgo(40) }),
          rawJob({ externalId: "b2", company: "Initech", title: "QA Tester", url: "https://himalayas.app/jobs/b2", postedAt: daysAgo(41) }),
        ],
      },
    ],
    errors: [],
  });
  await runIngestion(db, [board], { staleAfterDays: 30 });
  db.prepare("UPDATE jobs SET apply_url = ?, apply_method = 'ats-discovery' WHERE id = 'himalayas:b1'").run("https://jobs.lever.co/globex/1");

  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

describe("GET /api/jobs", () => {
  it("lists newest first with pagination metadata", async () => {
    const { status, body } = await get("/api/jobs?pageSize=2");
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 6, page: 1, pageSize: 2, hasMore: true });
    expect(body.jobs.map((j: any) => j.id)).toEqual(["greenhouse:1", "greenhouse:4"]);
    expect(body.jobs[0]).toMatchObject({ sourceName: "Greenhouse", category: "software-development", seniority: "senior", skills: ["TypeScript", "React"] });
    expect(body.jobs[0]).not.toHaveProperty("description");
  });

  it("searches spelling-insensitively across words", async () => {
    const { body } = await get("/api/jobs?q=frontend%20senior");
    expect(body.jobs.map((j: any) => j.id)).toEqual(["greenhouse:1"]);
  });

  it.each([
    ["category=design", ["greenhouse:2"]],
    ["workplace=onsite", ["greenhouse:2"]],
    ["skills=Go,Kafka", ["greenhouse:3"]],
    ["minSalary=100000", ["greenhouse:1"]],
    ["postedWithin=7&category=software-development", ["greenhouse:1"]],
    // BR: unrestricted remote + LATAM; never the Berlin on-site or US-only jobs.
    ["country=br", ["greenhouse:1", "greenhouse:4", "himalayas:b1", "himalayas:b2"]],
    ["country=DE", ["greenhouse:1", "greenhouse:2", "himalayas:b1", "himalayas:b2"]],
  ])("filters by %s", async (query, ids) => {
    const { body } = await get(`/api/jobs?${query}`);
    expect(body.jobs.map((j: any) => j.id)).toEqual(ids);
  });

  it("points Apply at the employer's posting when known, and can filter to those", async () => {
    const { body } = await get("/api/jobs?pageSize=50");
    const byId = Object.fromEntries(body.jobs.map((j: any) => [j.id, j]));
    expect(byId["greenhouse:1"]).toMatchObject({ applyUrl: "https://example.com/jobs/1", applyDirect: true });
    expect(byId["himalayas:b1"]).toMatchObject({ url: "https://himalayas.app/jobs/b1", applyUrl: "https://jobs.lever.co/globex/1", applyDirect: true });
    expect(byId["himalayas:b2"]).toMatchObject({ applyUrl: "https://himalayas.app/jobs/b2", applyDirect: false });

    const direct = await get("/api/jobs?direct=true&pageSize=50");
    expect(direct.body.jobs.map((j: any) => j.id)).not.toContain("himalayas:b2");
    expect(direct.body.total).toBe(5);

    const detail = await get("/api/jobs/himalayas%3Ab1");
    expect(detail.body.applyMethod).toBe("ats-discovery");
  });

  it("counts the matching roles that are new this week", async () => {
    const all = await get("/api/jobs");
    expect(all.body).toMatchObject({ total: 6, newLast7Days: 3 });

    // BR matches two recent roles and the two old board listings.
    const filtered = await get("/api/jobs?country=br");
    expect(filtered.body).toMatchObject({ total: 4, newLast7Days: 2 });
  });

  it("rejects invalid filters with 400", async () => {
    const { status, body } = await get("/api/jobs?category=nope&country=Brazil");
    expect(status).toBe(400);
    expect(Object.keys(body.details)).toEqual(expect.arrayContaining(["category", "country"]));
  });
});

describe("GET /api/jobs/:id", () => {
  it("returns the full job with description", async () => {
    const { status, body } = await get("/api/jobs/greenhouse%3A1");
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: "greenhouse:1", description: "React, TypeScript", closedAt: null, alsoOn: [] });
  });

  it("404s for unknown ids", async () => {
    expect((await get("/api/jobs/nope")).status).toBe(404);
  });
});

describe("GET /api/stats", () => {
  it("reports totals, facets and source health", async () => {
    const { body } = await get("/api/stats");
    expect(body.totals).toMatchObject({ openJobs: 6, companies: 3, remote: 5, withSalary: 1, newLast7Days: 3 });
    expect(body.categories.find((c: any) => c.id === "design")).toMatchObject({ count: 1 });
    expect(body.countries).toEqual(expect.arrayContaining(["BR", "DE", "US"]));
    expect(body.sources.find((s: any) => s.id === "greenhouse")).toMatchObject({ openJobs: 5, lastRun: { status: "ok", fetched: 5 } });
  });
});

describe("evergreen ATS postings", () => {
  it("are left out of the listing, its counts, stats, RSS and the sitemap", async () => {
    const list = await get("/api/jobs?pageSize=50");
    expect(list.body.jobs.map((j: any) => j.id)).not.toContain("greenhouse:5");
    expect(list.body.total).toBe(6);
    expect((await get("/api/stats")).body.totals.openJobs).toBe(6);
    expect(await (await fetch(`${base}/api/jobs/feed.xml`)).text()).not.toContain("greenhouse:5");
    expect(await (await fetch(`${base}/sitemap.xml`)).text()).not.toContain("greenhouse%3A5");
  });

  it("stay open: reachable by id and through the source filter", async () => {
    expect((await get("/api/jobs/greenhouse%3A5")).body).toMatchObject({ id: "greenhouse:5", closedAt: null });
    const bySource = await get("/api/jobs?source=greenhouse&pageSize=50");
    expect(bySource.body.jobs.map((j: any) => j.id)).toContain("greenhouse:5");
  });
});
