import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { normalizeJob } from "../src/normalize/index.js";
import { createGetOnBrdSource, getOnBrdPageUrl, toRawJob, type GetOnBrdJob, type GetOnBrdResponse } from "../src/sources/getonbrd.js";

const T0 = new Date("2026-10-28T12:00:00Z");

function job(id: string, overrides: Partial<GetOnBrdJob["attributes"]> = {}): GetOnBrdJob {
  return {
    id,
    type: "job",
    attributes: {
      title: `Backend Developer ${id}`,
      description: "<p>Node.js y PostgreSQL.</p>",
      remote_modality: "fully_remote",
      countries: ["Remote"],
      published_at: T0.getTime() / 1000 - 86_400,
      company: { data: { id: "acme", type: "company", attributes: { name: "Acme", logo: "https://example.com/acme.png" } } },
      ...overrides,
    },
    links: { public_url: `https://www.getonbrd.com/jobs/${id}` },
  };
}

/** Paged categories: `pages[category][i]` is served at page i + 1. */
function feed(pages: Record<string, string[][]>) {
  const requested: string[] = [];
  const fetchPage = async (url: string): Promise<GetOnBrdResponse> => {
    requested.push(url);
    const category = /categories\/([^/]+)\/jobs/.exec(url)?.[1] as string;
    const page = Number(new URL(url).searchParams.get("page"));
    const ids = pages[category]?.[page - 1];
    if (!ids) throw new Error(`unexpected ${url}`);
    return { data: ids.map((id) => job(id)), meta: { page, per_page: 100, total_pages: pages[category]?.length ?? 0 } };
  };
  return { fetchPage, requested };
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function openIds(db: Db): string[] {
  return (db.prepare("SELECT external_id FROM jobs WHERE closed_at IS NULL ORDER BY external_id").all() as { external_id: string }[]).map(
    (r) => r.external_id,
  );
}

describe("Get on Board mapping", () => {
  const normalize = (j: GetOnBrdJob, category = "programming") => normalizeJob("getonbrd", "all", toRawJob(j, category));

  it("maps a fully remote role with salary, seniority and the public job page", () => {
    const n = normalize(
      job("backend-dev-acme", {
        title: "Backend Developer",
        min_salary: 2500,
        max_salary: 3500,
        seniority: { data: { id: "3", type: "seniority", attributes: { name: "Semi Senior", locale_key: "semi_senior" } } },
        modality: { data: { id: "1", type: "modality", attributes: { name: "Full time", locale_key: "full_time" } } },
        tags: { data: [{ id: "node-js", type: "tag", attributes: { name: "Node.js" } }] },
      }),
    );
    expect(n).toMatchObject({
      id: "getonbrd:backend-dev-acme",
      company: "Acme",
      url: "https://www.getonbrd.com/jobs/backend-dev-acme",
      workplace: "remote",
      allowedCountries: null,
      category: "software-development",
      seniority: "mid",
      employmentType: "full_time",
      salary: { min: 2500, max: 3500, currency: "USD", period: "month" },
      salaryMinUsdYear: 30_000,
      tags: ["Node.js"],
      postedAt: new Date(T0.getTime() - 86_400_000).toISOString(),
    });
  });

  it("limits a remote_local role to its countries and regions", () => {
    const n = normalize(
      job("x", {
        remote_modality: "remote_local",
        location_tenants: { data: [{ id: "chile", type: "country", attributes: { name: "Chile" } }, { id: "peru", type: "country", attributes: { name: "Peru" } }] },
        location_regions: { data: [{ id: "central_america", type: "region", attributes: { name: "Central America" } }] },
      }),
    );
    expect(n.workplace).toBe("remote");
    expect(n.allowedCountries).toEqual(["CL", "CR", "GT", "MX", "PA", "PE"]);
  });

  it.each<[string, string, string]>([
    ["hybrid", "hybrid", "hybrid"],
    ["no_remote", "onsite", "onsite"],
  ])("places a %s role in its cities", (modality, workplace) => {
    const n = normalize(
      job("x", {
        remote_modality: modality,
        countries: ["Chile", "Mexico"],
        location_cities: { data: [{ id: "1", type: "tenant_city", attributes: { name: "Santiago", country: "Chile" } }] },
      }),
    );
    expect(n.workplace).toBe(workplace);
    expect(n.locations).toEqual(["Santiago, Chile", "Mexico"]);
    expect(n.allowedCountries).toEqual(["CL", "MX"]);
  });

  it("uses the category as a hint when the title is inconclusive, and leaves salary empty when not given", () => {
    const n = normalize(job("x", { title: "Especialista Snowflake" }), "data-science-analytics");
    expect(n.category).toBe("data");
    expect(n.salary).toBeNull();
  });

  it("asks for the related resources it maps", () => {
    const url = new URL(getOnBrdPageUrl("programming", 2));
    expect(url.pathname).toBe("/api/v0/categories/programming/jobs");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.getAll("expand[]")).toEqual(expect.arrayContaining(["company", "seniority", "location_tenants"]));
  });
});

describe("Get on Board paging", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("reads every category to its last page and reports the feed complete", async () => {
    const { fetchPage, requested } = feed({ programming: [ids("a", 3), ids("b", 2)], cybersecurity: [ids("c", 2)] });
    const outcome = await createGetOnBrdSource({ fetchPage, categories: ["programming", "cybersecurity"], pageDelayMs: 0 }).fetchJobs();
    expect(requested).toEqual([getOnBrdPageUrl("programming", 1), getOnBrdPageUrl("programming", 2), getOnBrdPageUrl("cybersecurity", 1)]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({ feed: "all", complete: true });
    expect(outcome.results[0]?.jobs).toHaveLength(7);
  });

  it("keeps a role listed twice once", async () => {
    const { fetchPage } = feed({ programming: [["a0", "a1"], ["a1", "a2"]], "design-ux": [["a0"]] });
    const outcome = await createGetOnBrdSource({ fetchPage, categories: ["programming", "design-ux"], pageDelayMs: 0 }).fetchJobs();
    expect(outcome.results[0]?.jobs.map((j) => j.externalId)).toEqual(["a0", "a1", "a2"]);
  });

  it("closes roles missing from a feed read to the end", async () => {
    const categories = ["programming", "cybersecurity"];
    const first = feed({ programming: [ids("a", 10), ids("b", 5)], cybersecurity: [ids("c", 5)] });
    await runIngestion(db, [createGetOnBrdSource({ fetchPage: first.fetchPage, categories, pageDelayMs: 0 })], { staleAfterDays: 30, now: () => T0 });
    expect(openIds(db)).toHaveLength(20);

    const second = feed({ programming: [ids("a", 10), ids("b", 4)], cybersecurity: [ids("c", 4)] });
    const [summary] = await runIngestion(db, [createGetOnBrdSource({ fetchPage: second.fetchPage, categories, pageDelayMs: 0 })], {
      staleAfterDays: 30,
      force: true,
      now: () => new Date(T0.getTime() + 3_600_000),
    });
    expect(summary).toMatchObject({ status: "ok", fetched: 18, closed: 2 });
    expect(openIds(db)).not.toContain("b4");
    expect(openIds(db)).not.toContain("c4");
  });

  it("is not complete when the page cap cuts a category short, so nothing is closed", async () => {
    const pages = { programming: [ids("a", 10), ids("b", 10), ids("c", 10)] };
    await runIngestion(db, [createGetOnBrdSource({ fetchPage: feed(pages).fetchPage, categories: ["programming"], pageDelayMs: 0 })], {
      staleAfterDays: 30,
      now: () => T0,
    });

    const capped = createGetOnBrdSource({ fetchPage: feed(pages).fetchPage, categories: ["programming"], maxPages: 2, pageDelayMs: 0 });
    const outcome = await capped.fetchJobs();
    expect(outcome.results[0]).toMatchObject({ complete: false });
    expect(outcome.results[0]?.jobs).toHaveLength(20);
    expect(outcome.errors[0]?.error).toMatch(/programming: stopped at the 2-page cap/);

    const [summary] = await runIngestion(db, [capped], { staleAfterDays: 30, force: true, now: () => new Date(T0.getTime() + 3_600_000) });
    expect(summary).toMatchObject({ status: "partial", closed: 0 });
    expect(openIds(db)).toHaveLength(30);
  });

  it("keeps the other categories when one fails, without closing anything", async () => {
    const { fetchPage } = feed({ programming: [ids("a", 3)] });
    const failing = (url: string) => (url.includes("/cybersecurity/") ? Promise.reject(new Error("responded 503")) : fetchPage(url));
    const outcome = await createGetOnBrdSource({ fetchPage: failing, categories: ["programming", "cybersecurity"], pageDelayMs: 0 }).fetchJobs();
    expect(outcome.results[0]).toMatchObject({ complete: false });
    expect(outcome.results[0]?.jobs).toHaveLength(3);
    expect(outcome.errors).toEqual([{ feed: "all", error: "cybersecurity: stopped early: responded 503" }]);
  });

  it("reports an error and no results when nothing could be read", async () => {
    const outcome = await createGetOnBrdSource({ fetchPage: () => Promise.reject(new Error("down")), categories: ["programming"], pageDelayMs: 0 }).fetchJobs();
    expect(outcome.results).toEqual([]);
    expect(outcome.errors).toHaveLength(1);
  });
});
