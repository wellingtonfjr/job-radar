import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";
import { deleteAgedPostings, deleteOffTopicRoles, discoveredBoards, pruneOldRows, runIngestion } from "../src/ingestion/pipeline.js";
import { fetchBoards } from "../src/sources/boards.js";
import type { CompanyBoard } from "../src/sources/companies.js";
import type { FetchOutcome, SourceAdapter } from "../src/sources/types.js";
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
    const jobs = Array.from({ length: 20 }, (_, i) => rawJob({ externalId: String(i), title: `Engineer ${i}` }));
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

  it("reads discovered boards that matched a listing, keeps them open, and forgets boards that are gone", async () => {
    const board = db.prepare("INSERT INTO ats_boards (company_key, provider, token, checked_at, company_name, matched_at) VALUES (?, ?, ?, ?, ?, ?)");
    board.run("globex", "ats", "globex", T0.toISOString(), "Globex", T0.toISOString());
    board.run("initech", "ats", "initech", T0.toISOString(), "Initech", hoursLater(1).toISOString());
    board.run("hooli", "ats", "hooli", T0.toISOString(), null, null); // found, but never matched a listing
    board.run("acme", "ats", "acme", T0.toISOString(), "Acme", T0.toISOString()); // already curated
    expect(discoveredBoards(db, "ats", ["acme"])).toEqual([
      { token: "globex", name: "Globex" },
      { token: "initech", name: "Initech" },
    ]);

    let given: readonly CompanyBoard[] = [];
    let respond = (boards: readonly CompanyBoard[]): FetchOutcome => ({
      results: boards.map((b) => ({ feed: b.token, complete: true, jobs: [rawJob({ externalId: b.token, company: b.name })] })),
      errors: [],
    });
    const ats: SourceAdapter = {
      ...fakeSource("ats"),
      feeds: ["acme"],
      fetchJobs: async (context) => {
        given = context?.discoveredBoards ?? [];
        return respond([{ token: "acme", name: "Acme" }, ...given]);
      },
    };
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    expect(given.map((b) => b.token)).toEqual(["globex", "initech"]);
    expect(openIds(db)).toEqual(["ats:acme", "ats:globex", "ats:initech"]);
    expect(db.prepare("SELECT company FROM jobs WHERE id = 'ats:globex'").get()).toEqual({ company: "Globex" });

    // Initech's board is deleted upstream: its board is forgotten, its open jobs stay until the next good read.
    respond = (boards) => ({
      results: boards.filter((b) => b.token !== "initech").map((b) => ({ feed: b.token, complete: true, jobs: [rawJob({ externalId: b.token, company: b.name })] })),
      errors: [{ feed: "initech", error: "responded 404", gone: true }],
    });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(openIds(db)).toEqual(["ats:acme", "ats:globex", "ats:initech"]);
    expect(db.prepare("SELECT provider, token, matched_at FROM ats_boards WHERE company_key = 'initech'").get()).toEqual({
      provider: null,
      token: null,
      matched_at: null,
    });

    // The next run no longer lists Initech, so its jobs close with the feed.
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(4) });
    expect(given.map((b) => b.token)).toEqual(["globex"]);
    expect(openIds(db)).toEqual(["ats:acme", "ats:globex"]);
  });

  it("writes each board as it arrives instead of holding them all, with the same result", async () => {
    // More boards than are fetched at once (4), so later ones start after earlier ones are written.
    const boards: CompanyBoard[] = ["acme", "globex", "initech", "hooli", "umbrella", "soylent"].map((token) => ({ token, name: token }));
    let failing = "";
    // Counts how many boards the pipeline has written by the time each board is fetched.
    const writtenWhenFetched: number[] = [];
    const ats: SourceAdapter = {
      ...fakeSource("ats"),
      feeds: boards.map((b) => b.token),
      fetchJobs: (context) =>
        fetchBoards(
          boards,
          async (b) => {
            writtenWhenFetched.push(openIds(db).length);
            if (b.token === failing) throw new Error("responded 500");
            return [rawJob({ externalId: b.token, company: b.name }), rawJob({ externalId: `${b.token}-2`, title: "Designer", company: b.name })];
          },
          context,
        ),
    };

    const [first] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    expect(first).toMatchObject({ status: "ok", fetched: 12, inserted: 12, closed: 0 });
    expect(openIds(db)).toHaveLength(12);
    // The fifth board starts only once a slot frees up, and by then the board
    // that freed it is already in the database.
    expect(writtenWhenFetched[4]).toBeGreaterThanOrEqual(2);

    // With emit, fetchBoards returns no results: the pipeline already has them.
    const emitted: string[] = [];
    const outcome = await fetchBoards(boards, async (b) => [rawJob({ externalId: b.token })], {
      storedDescription: () => null,
      emit: (r) => emitted.push(r.feed),
    });
    expect(outcome.results).toEqual([]);
    expect(emitted.sort()).toEqual(["acme", "globex", "hooli", "initech", "soylent", "umbrella"]);

    // A board failing mid-run keeps its jobs open; the others still close what's gone.
    failing = "globex";
    const [second] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(second).toMatchObject({ status: "partial", fetched: 10, closed: 0 });
    expect(second?.errors).toEqual([{ feed: "globex", error: "responded 500" }]);
    expect(openIds(db)).toHaveLength(12);
  });

  it("keeps tech roles only: skips the rest, deletes stored ones without counting them as closed", async () => {
    const ats = fakeSource("ats");
    const jobs = [
      ...Array.from({ length: 6 }, (_, i) => rawJob({ externalId: `e${i}`, title: `Backend Engineer ${i}` })),
      rawJob({ externalId: "ae", title: "Account Executive" }),
      rawJob({ externalId: "hr", title: "Recruiter" }),
    ];
    ats.respond({ results: [{ feed: "acme", complete: true, jobs }], errors: [] });
    const [first] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    expect(first).toMatchObject({ status: "ok", fetched: 6, inserted: 6 });
    expect(openIds(db)).toHaveLength(6);

    // A role stored before the rule (or reclassified since) goes at the next read of its feed.
    db.prepare("UPDATE jobs SET category = 'sales' WHERE id = 'ats:e0'").run();
    db.prepare("UPDATE jobs SET category = 'finance' WHERE id = 'ats:e1'").run();
    // ...and wherever it is, the cleanup deletes it in batches.
    const agg = fakeSource("agg", "aggregator");
    agg.respond({ results: [{ feed: "all", complete: false, jobs: [rawJob({ externalId: "x", title: "Frontend Developer" })] }], errors: [] });
    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => T0 });
    db.prepare("UPDATE jobs SET category = 'healthcare' WHERE id = 'agg:x'").run();

    const [second] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    // e0 and e1 are re-read as tech roles (their titles say so) and kept; nothing closes.
    expect(second).toMatchObject({ status: "ok", fetched: 6, closed: 0 });
    expect(await deleteOffTopicRoles(db, { batchSize: 1, pauseMs: 0 })).toBe(1);
    expect(openIds(db)).not.toContain("agg:x");
    expect(await deleteOffTopicRoles(db)).toBe(0);
  });

  it("doesn't let off-topic jobs weaken the drop guard on a mixed board", async () => {
    const ats = fakeSource("ats");
    const tech = Array.from({ length: 10 }, (_, i) => rawJob({ externalId: `t${i}`, title: `Backend Engineer ${i}` }));
    const sales = Array.from({ length: 15 }, (_, i) => rawJob({ externalId: `s${i}`, title: `Account Executive ${i}` }));
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [...tech, ...sales] }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toHaveLength(10);

    // A glitch returns 3 of the 10 tech roles but every sales role: nothing closes.
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [...tech.slice(0, 3), ...sales] }], errors: [] });
    const [glitch] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(glitch).toMatchObject({ status: "partial", closed: 0 });
    expect(glitch?.errors[0]?.error).toMatch(/listed 3 of 10/);
    expect(openIds(db)).toHaveLength(10);
  });

  it("deletes a role that its feed now lists as non-tech, with its description", async () => {
    const ats = fakeSource("ats");
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1", title: "Backend Engineer", descriptionText: "Go." }), rawJob({ externalId: "2", title: "Frontend Engineer" })] }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    // The same posting is retitled as a sales role.
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1", title: "Account Executive" }), rawJob({ externalId: "2", title: "Frontend Engineer" })] }], errors: [] });
    const [run] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(run).toMatchObject({ closed: 0, offTopic: 1 });
    expect(db.prepare("SELECT id FROM jobs ORDER BY id").all()).toEqual([{ id: "ats:2" }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM job_descriptions").get()).toEqual({ n: 0 });
  });

  it("deletes a feed's stored off-topic roles during ingestion, counted apart from closures", async () => {
    const ats = fakeSource("ats");
    const jobs = Array.from({ length: 4 }, (_, i) => rawJob({ externalId: String(i), title: `Data Engineer ${i}` }));
    ats.respond({ results: [{ feed: "acme", complete: true, jobs }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    // Stored under an older classification as non-tech, and no longer in the feed.
    db.prepare("INSERT INTO jobs (id, source, feed, external_id, title, company, company_key, url, workplace, category, search_text, fingerprint, source_rank, first_seen_at, last_seen_at) VALUES ('ats:old', 'ats', 'acme', 'old', 'Sales Lead', 'Acme', 'acme', 'https://e.x/old', 'remote', 'sales', 's', 'f-old', 0, ?, ?)").run(T0.toISOString(), T0.toISOString());
    const [run] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => hoursLater(2) });
    expect(run).toMatchObject({ status: "ok", closed: 0, offTopic: 1 });
    expect(openIds(db)).toHaveLength(4);
  });

  it("runs due sources one at a time, never two at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = (id: string): SourceAdapter => ({
      ...fakeSource(id),
      fetchJobs: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { results: [{ feed: id, complete: true, jobs: [rawJob({ externalId: "1" })] }], errors: [] };
      },
    });
    const summaries = await runIngestion(db, [slow("a"), slow("b"), slow("c")], { staleAfterDays: 30, now: () => T0 });
    expect(summaries.map((s) => [s.source, s.status])).toEqual([["a", "ok"], ["b", "ok"], ["c", "ok"]]);
    expect(maxInFlight).toBe(1);
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
      results: [{ feed: "all", complete: false, jobs: [rawJob({ externalId: "old" }), rawJob({ externalId: "exp", title: "X Engineer", expiresAt: hoursLater(1).toISOString() })] }],
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

  it("retries a source whose last run never finished (the process stopped mid-run)", async () => {
    const ats = fakeSource("ats");
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1" })] }], errors: [] });
    // What a run cut short by a restart leaves behind: started, never finished.
    db.prepare("INSERT INTO source_runs (source, started_at) VALUES ('ats', ?)").run(T0.toISOString());

    const [run] = await runIngestion(db, [ats], { staleAfterDays: 30, minIntervalMinutes: 12 * 60, now: () => hoursLater(0.5) });
    expect(run?.status).toBe("ok");
    expect(openIds(db)).toEqual(["ats:1"]);
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

  it("doesn't store postings older than the listing age, from any source", async () => {
    const ats = fakeSource("ats");
    const agg = fakeSource("agg", "aggregator");
    const daysBefore = (d: number) => new Date(T0.getTime() - d * 86_400_000).toISOString();
    ats.respond({
      results: [
        {
          feed: "acme",
          complete: true,
          jobs: [
            rawJob({ externalId: "new", title: "Backend Engineer", postedAt: daysBefore(59) }),
            rawJob({ externalId: "old", title: "Forward Deployed Engineer", postedAt: daysBefore(61) }),
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
            // Job boards are subject to the age rule too.
            rawJob({ externalId: "aged", title: "Data Analyst", company: "Globex", postedAt: daysBefore(61) }),
            rawJob({ externalId: "fresh", title: "QA Tester", company: "Initech", postedAt: daysBefore(10) }),
          ],
        },
      ],
      errors: [],
    });
    await runIngestion(db, [ats, agg], { staleAfterDays: 30, now: () => T0 });

    // The old ATS posting isn't stored, but it's remembered, so the job
    // board's copy of it (with a newer date) doesn't resurface.
    expect(db.prepare("SELECT id, canonical, closed_at FROM jobs ORDER BY id").all()).toEqual([
      { id: "agg:copy", canonical: 0, closed_at: null },
      { id: "agg:fresh", canonical: 1, closed_at: null },
      { id: "ats:new", canonical: 1, closed_at: null },
    ]);
    // Only the employer's listing is remembered, not the board's own aged roles.
    expect(db.prepare("SELECT COUNT(*) AS n FROM aged_fingerprints").get()).toEqual({ n: 1 });

    // Once the employer stops listing it (no refresh for over a week), the board copy shows again.
    agg.respond({
      results: [{ feed: "all", complete: true, jobs: [rawJob({ externalId: "copy", title: "Forward Deployed Engineer", postedAt: daysBefore(2) })] }],
      errors: [],
    });
    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => new Date(T0.getTime() + 8 * 86_400_000) });
    expect(db.prepare("SELECT canonical FROM jobs WHERE id = 'agg:copy'").get()).toEqual({ canonical: 1 });
  });

  it("deletes stored roles once they age past the listing age, without counting them as closed or tripping the drop guard", async () => {
    const ats = fakeSource("ats");
    const daysBefore = (d: number) => new Date(T0.getTime() - d * 86_400_000).toISOString();
    // 20 roles: 15 published 50 days ago, 5 published 5 days ago.
    const jobs = Array.from({ length: 20 }, (_, i) => rawJob({ externalId: String(i), title: `Engineer ${i}`, postedAt: daysBefore(i < 15 ? 50 : 5) }));
    ats.respond({ results: [{ feed: "acme", complete: true, jobs }], errors: [] });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toHaveLength(20);

    // 15 days later the first 15 are over 60 days old: still listed upstream, but no longer stored.
    const later = new Date(T0.getTime() + 15 * 86_400_000);
    const [run] = await runIngestion(db, [ats], { staleAfterDays: 30, now: () => later });
    expect(run).toMatchObject({ status: "ok", fetched: 5, closed: 0, aged: 15 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 5 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM aged_fingerprints").get()).toEqual({ n: 15 });
  });

  it("deletes aged roles of partially read feeds in batches, with their descriptions, and keeps undated ones", async () => {
    const agg = fakeSource("agg", "aggregator");
    const daysBefore = (d: number) => new Date(T0.getTime() - d * 86_400_000).toISOString();
    agg.respond({
      results: [
        {
          feed: "all",
          complete: false,
          jobs: [
            ...Array.from({ length: 5 }, (_, i) => rawJob({ externalId: `a${i}`, title: `Aging Engineer ${i}`, postedAt: daysBefore(50), descriptionText: "Old." })),
            rawJob({ externalId: "undated", title: "Undated Engineer", postedAt: null }),
            rawJob({ externalId: "fresh", title: "Fresh Engineer", postedAt: daysBefore(1) }),
          ],
        },
      ],
      errors: [],
    });
    await runIngestion(db, [agg], { staleAfterDays: 30, now: () => T0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM job_descriptions").get()).toEqual({ n: 5 });

    const later = new Date(T0.getTime() + 15 * 86_400_000);
    expect(await deleteAgedPostings(db, later, { batchSize: 2, pauseMs: 0 })).toBe(5);
    expect(openIds(db)).toEqual(["agg:fresh", "agg:undated"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM job_descriptions").get()).toEqual({ n: 0 });
    expect(await deleteAgedPostings(db, later)).toBe(0);
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
      // Undated, so only the closed-age rule applies (not the posting-age one).
      results: [{ feed: "acme", complete: true, jobs: ids.map((id) => rawJob({ externalId: id, title: `Engineer ${id}`, postedAt: null })) }],
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
    ats.respond({ results: [{ feed: "acme", complete: true, jobs: [rawJob({ externalId: "1", title: "Backend Engineer", postedAt: null })] }], errors: [] });
    agg.respond({ results: [{ feed: "all", complete: true, jobs: [rawJob({ externalId: "9", title: "Backend Engineer", postedAt: null })] }], errors: [] });
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

describe("remote roles repeated per city", () => {
  it("lists one copy by default and, per country, one copy per set of accepted countries", async () => {
    const db = openDb(":memory:");
    const ats = fakeSource("ats");
    const copy = (id: string, locations: string[]) => rawJob({ externalId: id, title: "Product Manager - Remote, Latin America", company: "Bluelight", locations });
    ats.respond({
      results: [
        {
          feed: "bluelight",
          complete: true,
          jobs: [
            copy("1", ["Remote - Paraguay"]),
            copy("2", ["Remote - Paraguay"]),
            copy("3", ["Remote - Brazil"]),
            copy("4", ["Remote - Brazil"]),
            // On-site roles in several cities are separate openings: kept.
            rawJob({ externalId: "5", title: "Backend Engineer", company: "Bluelight", workplace: "onsite", locations: ["Berlin"] }),
            rawJob({ externalId: "6", title: "Backend Engineer", company: "Bluelight", workplace: "onsite", locations: ["Munich"] }),
          ],
        },
      ],
      errors: [],
    });
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => T0 });
    const repeats = Object.fromEntries((db.prepare("SELECT id, remote_repeat FROM jobs").all() as { id: string; remote_repeat: number }[]).map((r) => [r.id, r.remote_repeat]));
    expect(repeats).toEqual({ "ats:1": 0, "ats:2": 2, "ats:3": 1, "ats:4": 2, "ats:5": 0, "ats:6": 0 });

    const server = createApp(db).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ids = async (q: string) => ((await (await fetch(`${base}/api/jobs?${q}`)).json()) as { jobs: { id: string }[] }).jobs.map((j) => j.id).sort();
    try {
      expect(await ids("pageSize=50")).toEqual(["ats:1", "ats:5", "ats:6"]);
      expect(await ids("country=BR")).toEqual(["ats:3"]);
      expect(await ids("country=PY")).toEqual(["ats:1"]);
      expect(((await (await fetch(`${base}/api/stats`)).json()) as { totals: { openJobs: number } }).totals.openJobs).toBe(3);
    } finally {
      server.close();
    }
  });
});
