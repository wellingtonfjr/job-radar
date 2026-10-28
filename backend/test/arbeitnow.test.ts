import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import type { SourceAdapter } from "../src/sources/types.js";
import { arbeitnowSkipReason, createArbeitnowSource, type ArbeitnowJob, type ArbeitnowResponse } from "../src/sources/arbeitnow.js";

const T0 = new Date("2026-10-15T12:00:00Z");
const FIRST = "https://www.arbeitnow.com/api/job-board-api";

function job(slug: string, overrides: Partial<ArbeitnowJob> = {}): ArbeitnowJob {
  return {
    slug,
    company_name: "Acme",
    title: `Engineer ${slug}`,
    remote: true,
    url: `https://www.arbeitnow.com/jobs/${slug}`,
    created_at: T0.getTime() / 1000 - 86_400,
    ...overrides,
  };
}

const EN = "<p>We are looking for someone who will join our team and work with you on the product.</p>";
const DE = "<p>Wir suchen eine Person für unser Team, die mit uns die Plattform weiterentwickelt und auch Verantwortung übernimmt.</p>";
const NL = "<p>Wij zoeken een collega voor ons team. Je werkt met een groep van experts aan het platform en bent ook verantwoordelijk.</p>";

/** A paged feed: `pages[i]` is served at page i + 1, with `links.next` until the last. */
function feed(pages: string[][]) {
  const requested: string[] = [];
  const fetchPage = async (url: string): Promise<ArbeitnowResponse> => {
    requested.push(url);
    const n = url === FIRST ? 1 : Number(new URL(url).searchParams.get("page"));
    const slugs = pages[n - 1];
    if (!slugs) throw new Error(`unexpected ${url}`);
    return { data: slugs.map((slug) => job(slug)), links: { next: n < pages.length ? `${FIRST}?page=${n + 1}` : null } };
  };
  return { fetchPage, requested };
}

const slugs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function openIds(db: Db): string[] {
  return (db.prepare("SELECT external_id FROM jobs WHERE closed_at IS NULL ORDER BY external_id").all() as { external_id: string }[]).map(
    (r) => r.external_id,
  );
}

describe("Arbeitnow paging", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("follows links.next to the end and reports the feed complete", async () => {
    const { fetchPage, requested } = feed([slugs("a", 3), slugs("b", 3), slugs("c", 2)]);
    const outcome = await createArbeitnowSource({ fetchPage, pageDelayMs: 0 }).fetchJobs();
    expect(requested).toEqual([FIRST, `${FIRST}?page=2`, `${FIRST}?page=3`]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({ feed: "all", complete: true });
    expect(outcome.results[0]?.jobs).toHaveLength(8);
  });

  it("closes roles missing from a feed read to the end", async () => {
    const first = feed([slugs("a", 10), slugs("b", 10)]);
    await runIngestion(db, [createArbeitnowSource({ fetchPage: first.fetchPage, pageDelayMs: 0 })], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toHaveLength(20);

    // Two roles gone upstream (b8, b9): well within the drop guard.
    const second = feed([slugs("a", 10), slugs("b", 8)]);
    const [summary] = await runIngestion(db, [createArbeitnowSource({ fetchPage: second.fetchPage, pageDelayMs: 0 })], {
      staleAfterDays: 30,
      force: true,
      now: () => new Date(T0.getTime() + 3_600_000),
    });
    expect(summary).toMatchObject({ status: "ok", fetched: 18, closed: 2 });
    expect(openIds(db)).not.toContain("b8");
    expect(openIds(db)).not.toContain("b9");
  });

  it("is not complete when the page cap cuts the feed short, so nothing is closed", async () => {
    const first = feed([slugs("a", 10), slugs("b", 10), slugs("c", 10)]);
    await runIngestion(db, [createArbeitnowSource({ fetchPage: first.fetchPage, pageDelayMs: 0 })], { staleAfterDays: 30, now: () => T0 });

    const capped = createArbeitnowSource({ fetchPage: feed([slugs("a", 10), slugs("b", 10), slugs("c", 10)]).fetchPage, maxPages: 2, pageDelayMs: 0 });
    const outcome = await capped.fetchJobs();
    expect(outcome.results[0]).toMatchObject({ complete: false });
    expect(outcome.results[0]?.jobs).toHaveLength(20);
    expect(outcome.errors[0]?.error).toMatch(/2-page cap/);

    const [summary] = await runIngestion(db, [capped], { staleAfterDays: 30, force: true, now: () => new Date(T0.getTime() + 3_600_000) });
    expect(summary).toMatchObject({ status: "partial", closed: 0 });
    expect(openIds(db)).toHaveLength(30);
  });

  it("keeps the pages read before a failure, without closing anything", async () => {
    const { fetchPage } = feed([slugs("a", 3)]);
    const failing = async (url: string) => (url === FIRST ? { ...(await fetchPage(url)), links: { next: `${FIRST}?page=2` } } : Promise.reject(new Error("challenge page")));
    const outcome = await createArbeitnowSource({ fetchPage: failing, pageDelayMs: 0 }).fetchJobs();
    expect(outcome.results[0]).toMatchObject({ complete: false });
    expect(outcome.results[0]?.jobs).toHaveLength(3);
    expect(outcome.errors[0]?.error).toMatch(/stopped early: challenge page/);
  });
});

describe("Arbeitnow filter", () => {
  it.each<[string, Partial<ArbeitnowJob>, string | null]>([
    ["English remote role", { title: "Account Executive", remote: true, description: EN }, null],
    ["English hybrid role", { title: "Account Executive", remote: false, location: "London (Hybrid)", description: EN }, null],
    ["English on-site tech role", { title: "Senior Backend Engineer", remote: false, location: "Berlin", description: EN }, null],
    ["English on-site product role", { title: "Product Manager", remote: false, location: "Paris", description: EN }, null],
    ["English on-site non-tech role", { title: "Account Executive", remote: false, location: "Berlin", description: EN }, "onsite-non-tech"],
    ["German tech role", { title: "DevOps Engineer (m/w/d)", remote: true, description: DE }, "not-english"],
    ["Dutch tech role", { title: "Software Engineer", remote: false, location: "Almelo", description: NL }, "not-english"],
    ["Werkstudent", { title: "Werkstudent Data Science (m/w/d)", remote: true, description: EN }, "not-a-job"],
    ["internship", { title: "Data Scientist Intern - Paris", remote: false, description: EN }, "not-a-job"],
    ["Praktikum", { title: "Praktikum Social Media & Marketing", remote: false, description: DE }, "not-a-job"],
    ["French stage", { title: "Stage Data Consultant - Paris", remote: false, description: EN }, "not-a-job"],
    ["Minijob", { title: "Interviewer (flexibler Minijob)", remote: false, description: DE }, "not-a-job"],
    ["filled ad", { title: "Succesvol ingevuld: Senior Growth Marketeer", remote: false, description: EN }, "not-a-job"],
    ["student job type", { title: "Customer Care", remote: true, job_types: ["Student college"], description: EN }, "not-a-job"],
    [
      "senior title despite an 'internship' job type",
      { title: "Associate Director - Sustainability", remote: true, job_types: ["internship"], description: EN },
      null,
    ],
    ["English 'early stage' role", { title: "Early Stage Software Engineer", remote: false, description: EN }, null],
    ["description too short to tell", { title: "Frontend Developer", remote: false, description: "<p>React</p>" }, null],
  ])("%s", (_, overrides, expected) => {
    expect(arbeitnowSkipReason(job("x", overrides))).toBe(expected);
  });

  it("leaves filtered roles out of the feed and counts them as skipped", async () => {
    const fetchPage = async (): Promise<ArbeitnowResponse> => ({
      data: [job("keep", { description: EN }), job("de", { description: DE }), job("ws", { title: "Werkstudent HR", description: EN })],
      links: { next: null },
    });
    const outcome = await createArbeitnowSource({ fetchPage, pageDelayMs: 0 }).fetchJobs();
    expect(outcome.results[0]).toMatchObject({ complete: true, skipped: 2 });
    expect(outcome.results[0]?.jobs.map((j) => j.externalId)).toEqual(["keep"]);
  });

  it("closes stored roles the filter now drops, without tripping the drop guard", async () => {
    const db = openDb(":memory:");
    const onsite = slugs("s", 20).map((slug) => job(slug, { title: "Account Executive", remote: false, location: "Berlin", description: EN }));
    const remote = ["r0", "r1"].map((slug) => job(slug, { description: EN }));
    const fetchPage = async (): Promise<ArbeitnowResponse> => ({ data: [...onsite, ...remote], links: { next: null } });

    // Before the filter existed, every role in the feed was stored.
    const unfiltered: SourceAdapter = {
      ...createArbeitnowSource({ fetchPage, pageDelayMs: 0 }),
      fetchJobs: async () => ({
        results: [{ feed: "all", complete: true, jobs: [...onsite, ...remote].map((j) => ({ externalId: j.slug, title: j.title, company: j.company_name, url: j.url, locations: [], workplace: null })) }],
        errors: [],
      }),
    };
    await runIngestion(db, [unfiltered], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toHaveLength(22);

    // The first filtered run keeps 2 of 22, far below the guard's 50%, but the
    // other 20 were listed and filtered on purpose, so they close.
    const [summary] = await runIngestion(db, [createArbeitnowSource({ fetchPage, pageDelayMs: 0 })], {
      staleAfterDays: 30,
      force: true,
      now: () => new Date(T0.getTime() + 3_600_000),
    });
    expect(summary).toMatchObject({ status: "ok", fetched: 2, closed: 20, errors: [] });
    expect(openIds(db)).toEqual(["r0", "r1"]);
  });

  it("still holds back closing when a complete feed really shrinks", async () => {
    const db = openDb(":memory:");
    const first = feed([slugs("a", 20)]);
    await runIngestion(db, [createArbeitnowSource({ fetchPage: first.fetchPage, pageDelayMs: 0 })], { staleAfterDays: 30, now: () => T0 });
    const [summary] = await runIngestion(db, [createArbeitnowSource({ fetchPage: feed([slugs("a", 5)]).fetchPage, pageDelayMs: 0 })], {
      staleAfterDays: 30,
      force: true,
      now: () => new Date(T0.getTime() + 3_600_000),
    });
    expect(summary).toMatchObject({ status: "partial", closed: 0 });
    expect(summary?.errors[0]?.error).toMatch(/listed 5 of 20/);
  });
});
