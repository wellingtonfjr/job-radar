import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/index.js";
import { pruneOldRows, runIngestion } from "../src/ingestion/pipeline.js";
import { fakeSource, rawJob } from "./helpers.js";

const T0 = new Date("2026-10-15T12:00:00Z");
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3_600_000);

function openIds(db: Db): string[] {
  return (db.prepare("SELECT id FROM jobs WHERE closed_at IS NULL ORDER BY id").all() as { id: string }[]).map((r) => r.id);
}

describe("runIngestion", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("inserts, then closes jobs that disappear from a complete feed, and reopens them if they return", async () => {
    const ats = fakeSource("ats");
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" }), rawJob({ externalId: "2", title: "Designer" })] }], errors: [] });
    const [first] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    expect(first).toMatchObject({ status: "ok", fetched: 2, inserted: 2, closed: 0 });

    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" })] }], errors: [] });
    const [second] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(second).toMatchObject({ fetched: 1, inserted: 0, closed: 1 });
    expect(openIds(db)).toEqual(["ats:1"]);

    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" }), rawJob({ externalId: "2", title: "Designer" })] }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(4) });
    expect(openIds(db)).toEqual(["ats:1", "ats:2"]);
    const firstSeen = db.prepare("SELECT first_seen_at FROM jobs WHERE id = 'ats:2'").get() as { first_seen_at: string };
    expect(firstSeen.first_seen_at).toBe(T0.toISOString());
  });

  it("doesn't trust a complete feed that suddenly lists under half of its open jobs", async () => {
    const ats = fakeSource("ats");
    const jobs = Array.from({ length: 20 }, (_, i) => rawJob({ externalId: String(i), title: `Role ${i}` }));
    ats.respond({ results: [{ feed: "acme", complete: true, jobs }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });

    ats.respond({ results: [{ feed: "acme", complete: true, jobs: jobs.slice(0, 6) }], errors: [] });
    const [glitch] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(glitch).toMatchObject({ status: "partial", closed: 0 });
    expect(glitch?.errors[0]?.error).toMatch(/listed 6 of 20/);
    expect(openIds(db)).toHaveLength(20);

    // A normal-sized drop is real and gets applied.
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: jobs.slice(0, 15) }], errors: [] });
    const [real] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(4) });
    expect(real).toMatchObject({ status: "ok", closed: 5 });
  });

  it("closes jobs of a company removed from a board source's list", async () => {
    const ats = fakeSource("ats");
    ats.respond({
      results: [
        { feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" })] },
        { feed: "globex", complete: true, jobs: [rawJob({ externalId: "2", company: "Globex" })] },
      ],
      errors: [],
    });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });

    ats.feeds = ["acme"];
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" })] }], errors: [] });
    const [summary] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(summary?.closed).toBe(1);
    expect(openIds(db)).toEqual(["ats:1"]);
  });

  it("closes jobs of a source removed from the registry, but only when told the registry", async () => {
    const ats = fakeSource("ats");
    const gone = fakeSource("gone", "aggregator");
    ats.respond({ results: [{ feed: "all", complete: true, jobs: [rawJob({ externalId: "1" })] }], errors: [] });
    gone.respond({ results: [{ feed: "all", complete: true, jobs: [rawJob({ externalId: "2", company: "Globex" })] }], errors: [] });
    await runIngestion(db, [ats, gone], { staleAfterDays: 30, now: () => T0 });

    // A run of a subset of sources (e.g. the CLI with one source) leaves the others alone.
    await runIngestion(db, [ats], { staleAfterDays: 30, force: true, now: () => hoursLater(1) });
    expect(openIds(db)).toEqual(["ats:1", "gone:2"]);

    await runIngestion(db, [ats], { staleAfterDays: 30, force: true, now: () => hoursLater(2), knownSources: ["ats"] });
    expect(openIds(db)).toEqual(["ats:1"]);
  });

  it("never closes jobs of a feed that failed or was only partially read", async () => {
    const ats = fakeSource("ats");
    ats.respond({
      results: [
        { feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" })] },
        { feed: "globex", complete: true, jobs: [rawJob({ externalId: "2", company: "Globex" })] },
      ],
      errors: [],
    });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });

    // globex fails, acme is read only partially (and now empty).
    ats.respond({ results: [{ feed: "acme", complete: false, jobs: [] }], errors: [{ feed: "globex", error: "HTTP 500" }] });
    const [summary] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(summary).toMatchObject({ status: "partial", closed: 0 });
    expect(openIds(db)).toEqual(["ats:1", "ats:2"]);
  });

  it("retires expired jobs and jobs unseen for too long", async () => {
    const agg = fakeSource("agg", "aggregator");
    agg.respond({
      results: [{ feed: "all", complete: false, jobs: [rawJob({ externalId: "old" }), rawJob({ externalId: "exp", title: "X", expiresAt: hoursLater(1).toISOString() })] }],
      errors: [],
    });
    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toEqual(["agg:exp", "agg:old"]);

    agg.respond({ results: [{ feed: "all", complete: false, jobs: [] }], errors: [] });
    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(openIds(db)).toEqual(["agg:old"]);

    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => hoursLater(31 * 24) });
    expect(openIds(db)).toEqual([]);
  });

  it("never stores jobs whose URL isn't a web address, and reports them", async () => {
    const agg = fakeSource("agg", "aggregator");
    agg.respond({
      results: [{ feed: "all", complete: true, jobs: [rawJob({ externalId: "ok" }), rawJob({ externalId: "evil", url: "javascript:alert(1)" })] }],
      errors: [],
    });
    const [summary] = await runIngestion(db, [agg], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toEqual(["agg:ok"]);
    expect(summary).toMatchObject({ status: "partial", fetched: 1, inserted: 1 });
    expect(summary?.errors).toEqual([{ feed: "all", error: "rejected unsafe or invalid URL for evil" }]);
  });

  it("never lists résumé pools, and retires ones stored earlier", async () => {
    const agg = fakeSource("agg", "aggregator");
    agg.respond({ results: [{ feed: "all", complete: false, jobs: [rawJob({ externalId: "1" }), rawJob({ externalId: "2", title: "Banco de Talentos - Tecnologia" })] }], errors: [] });
    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toEqual(["agg:1"]);

    // A pool stored by an older version of the pipeline, in a partially-read
    // feed that no longer returns it, still gets retired.
    db.exec("UPDATE jobs SET title = 'Talent Pool - Engineering' WHERE id = 'agg:1'");
    agg.respond({ results: [{ feed: "all", complete: false, jobs: [] }], errors: [] });
    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => hoursLater(2), force: true });
    expect(openIds(db)).toEqual([]);
  });

  it("applies a global minimum interval on top of each source's own", async () => {
    const ats = fakeSource("ats"); // own minimum: 60 min
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" })] }], errors: [] });
    const twiceADay = { staleAfterDays: 30, minIntervalMinutes: 12 * 60 };
    await runIngestion(db, [ats], { ...twiceADay, now: () => T0 });

    const [early] = await runIngestion(db, [ats], { ...twiceADay, now: () => hoursLater(6) });
    expect(early?.status).toBe("skipped");
    const [due] = await runIngestion(db, [ats], { ...twiceADay, now: () => hoursLater(12) });
    expect(due?.status).toBe("ok");
  });

  it("respects each source's minimum interval unless forced", async () => {
    const ats = fakeSource("ats");
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" })] }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    const [skipped] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(0.5) });
    expect(skipped?.status).toBe("skipped");
    const [forced] = await runIngestion(db, [ats], { staleAfterDays: 30, force: true, now: () => hoursLater(0.5) });
    expect(forced?.status).toBe("ok");
  });

  it("shows one copy per opening across sources, preferring the employer's ATS", async () => {
    const ats = fakeSource("ats");
    const agg = fakeSource("agg", "aggregator");
    ats.respond({
      results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1", title: "Backend Engineer" }), rawJob({ externalId: "2", title: "Backend Engineer", locations: ["Berlin"] })] }],
      errors: [],
    });
    agg.respond({ results: [{ feed: "all", complete: true, jobs: [rawJob({ externalId: "9", title: "Backend Engineer (Remote)", company: "ACME Inc." })] }], errors: [] });
    await runIngestion(db, [ats, agg], { staleAfterDays: 30, now: () => T0 });

    const rows = db.prepare("SELECT id, canonical FROM jobs ORDER BY id").all();
    // Same-source copies (two locations) both stay visible.
    expect(rows).toEqual([
      { id: "agg:9", canonical: 0 },
      { id: "ats:1", canonical: 1 },
      { id: "ats:2", canonical: 1 },
    ]);
  });

  it("hides evergreen ATS postings but keeps them open, and still hides their job-board copies", async () => {
    const ats = fakeSource("ats");
    const agg = fakeSource("agg", "aggregator");
    const daysBefore = (d: number) => new Date(T0.getTime() - d * 86_400_000).toISOString();
    ats.respond({
      results: [
        {
          feed: "acme",
          complete: true,
          jobs: [
            rawJob({ externalId: "new", title: "Backend Engineer", postedAt: daysBefore(179) }),
            rawJob({ externalId: "old", title: "Forward Deployed Engineer", postedAt: daysBefore(181) }),
          ],
        },
      ],
      errors: [],
    });
    agg.respond({
      results: [
        {
          feed: "all",
          complete: true,
          jobs: [
            rawJob({ externalId: "copy", title: "Forward Deployed Engineer", postedAt: daysBefore(2) }),
            // Aggregators aren't subject to the age rule.
            rawJob({ externalId: "aged", title: "Data Analyst", company: "Globex", postedAt: daysBefore(400) }),
          ],
        },
      ],
      errors: [],
    });
    await runIngestion(db, [ats, agg], { staleAfterDays: 30, now: () => T0 });

    expect(db.prepare("SELECT id, canonical, closed_at FROM jobs ORDER BY id").all()).toEqual([
      { id: "agg:aged", canonical: 1, closed_at: null },
      { id: "agg:copy", canonical: 0, closed_at: null },
      { id: "ats:new", canonical: 1, closed_at: null },
      { id: "ats:old", canonical: 0, closed_at: null },
    ]);
  });

  it("derives company pay tiers from published salaries", async () => {
    const ats = fakeSource("ats");
    const salary = (min: number) => ({ min, max: min + 20_000, currency: "USD", period: "year" as const });
    ats.respond({
      results: [
        {
          feed: "acme",
          complete: true,
          jobs: [
            rawJob({ externalId: "1", title: "Senior Engineer", salary: salary(150_000) }),
            rawJob({ externalId: "2", title: "Senior Designer", salary: salary(130_000) }),
            rawJob({ externalId: "3", title: "Junior Support", company: "Globex", salary: salary(40_000) }),
          ],
        },
      ],
      errors: [],
    });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    const tiers = db.prepare("SELECT company_key, tier, median_salary_usd FROM companies ORDER BY company_key").all();
    // Globex has a single data point: not enough to rate.
    expect(tiers).toEqual([{ company_key: "acme", tier: "S", median_salary_usd: 140_000 }]);
  });

  it("records a failed source without throwing", async () => {
    const broken = fakeSource("broken");
    broken.fetchJobs = async () => {
      throw new Error("boom");
    };
    const [summary] = await runIngestion(db, [broken], { staleAfterDays: 30, now: () => T0 });
    expect(summary).toMatchObject({ status: "error", errors: [{ feed: "*", error: "boom" }] });
    expect(db.prepare("SELECT status FROM source_runs").get()).toEqual({ status: "error" });
  });
});

describe("pruneOldRows", () => {
  let db: Db;
  const daysLater = (d: number) => hoursLater(d * 24);
  const allIds = () => (db.prepare("SELECT id FROM jobs ORDER BY id").all() as { id: string }[]).map((r) => r.id);
  beforeEach(() => {
    db = openDb(":memory:");
  });

  /** ats:old closes at T0+2h, ats:recent at day 80; ats:open stays open. */
  async function seed(): Promise<void> {
    const ats = fakeSource("ats");
    const feed = (...ids: string[]) => ({
      results: [{ feed: "acme", complete: true, jobs: ids.map((id) => rawJob({ externalId: id, title: `Role ${id}` })) }],
      errors: [],
    });
    ats.respond(feed("old", "recent", "open"));
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    ats.respond(feed("recent", "open"));
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    ats.respond(feed("open"));
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => daysLater(80) });
  }

  it("deletes only jobs closed more than N days ago", async () => {
    await seed();
    expect(pruneOldRows(db, daysLater(91), 90).jobs).toBe(1);
    expect(allIds()).toEqual(["ats:open", "ats:recent"]);
    expect(openIds(db)).toEqual(["ats:open"]);
  });

  it("keeps a closed job while an open job shares its fingerprint", async () => {
    const ats = fakeSource("ats");
    const agg = fakeSource("agg", "aggregator");
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1", title: "Backend Engineer" })] }], errors: [] });
    agg.respond({ results: [{ feed: "all", complete: true, jobs: [rawJob({ externalId: "9", title: "Backend Engineer" })] }], errors: [] });
    await runIngestion(db, [ats, agg], { staleAfterDays: 30, now: () => T0 });

    // The ATS copy closes; the aggregator copy of the same opening stays open.
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [] }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(openIds(db)).toEqual(["agg:9"]);

    expect(pruneOldRows(db, daysLater(100), 90).jobs).toBe(0);
    expect(allIds()).toEqual(["agg:9", "ats:1"]);
  });

  it("deletes source runs older than N days but keeps each source's latest", async () => {
    await seed();
    const runs = () => (db.prepare("SELECT source, started_at FROM source_runs ORDER BY id").all() as { started_at: string }[]).map((r) => r.started_at);
    expect(runs()).toHaveLength(3);

    // The T0 and T0+2h runs are past 90 days; the day-80 run is not.
    expect(pruneOldRows(db, daysLater(91), 90).sourceRuns).toBe(2);
    expect(runs()).toEqual([daysLater(80).toISOString()]);

    // Even once it is old, the source's last run stays (the stats show it).
    expect(pruneOldRows(db, daysLater(400), 90).sourceRuns).toBe(0);
    expect(runs()).toHaveLength(1);
  });

  it("does nothing when disabled with 0", async () => {
    await seed();
    expect(pruneOldRows(db, daysLater(400), 0)).toEqual({ jobs: 0, sourceRuns: 0, reports: 0 });
    expect(allIds()).toEqual(["ats:old", "ats:open", "ats:recent"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM source_runs").get()).toEqual({ n: 3 });
  });
});
