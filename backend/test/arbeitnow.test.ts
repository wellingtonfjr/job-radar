import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { createArbeitnowSource, type ArbeitnowJob, type ArbeitnowResponse } from "../src/sources/arbeitnow.js";

const T0 = new Date("2026-10-15T12:00:00Z");
const FIRST = "https://www.arbeitnow.com/api/job-board-api";

function job(slug: string): ArbeitnowJob {
  return { slug, company_name: "Acme", title: `Engineer ${slug}`, remote: true, url: `https://www.arbeitnow.com/jobs/${slug}`, created_at: T0.getTime() / 1000 - 86_400 };
}

/** A paged feed: `pages[i]` is served at page i + 1, with `links.next` until the last. */
function feed(pages: string[][]) {
  const requested: string[] = [];
  const fetchPage = async (url: string): Promise<ArbeitnowResponse> => {
    requested.push(url);
    const n = url === FIRST ? 1 : Number(new URL(url).searchParams.get("page"));
    const slugs = pages[n - 1];
    if (!slugs) throw new Error(`unexpected ${url}`);
    return { data: slugs.map(job), links: { next: n < pages.length ? `${FIRST}?page=${n + 1}` : null } };
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
