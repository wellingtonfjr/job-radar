import { afterEach, describe, expect, it, vi } from "vitest";
import { recruiteeDate, recruiteeSource } from "../src/sources/recruitee.js";
import { workableSource } from "../src/sources/workable.js";

/** Stubs fetch with JSON bodies by URL prefix; anything else is a 404. */
function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      return match ? new Response(JSON.stringify(routes[match])) : new Response("not found", { status: 404 });
    }),
  );
}

const context = (tokens: string[]) => ({
  storedDescription: () => null,
  discoveredBoards: tokens.map((token) => ({ token, name: token.toUpperCase() })),
});

afterEach(() => vi.unstubAllGlobals());

describe("Workable adapter", () => {
  it("reads curated and discovered accounts, and flags a missing account as gone", async () => {
    const job = {
      shortcode: "ABC123",
      title: "Frontend Engineer",
      url: "https://apply.workable.com/j/ABC123",
      employment_type: "Full-time",
      telecommuting: true,
      department: "Web",
      function: "Engineering",
      description: "<p>React</p>",
      published_on: "2026-11-01",
      locations: [{ city: "Lisbon", region: "Lisbon", country: "Portugal" }, { country: "Spain", hidden: true }],
    };
    stubFetch({
      "https://apply.workable.com/api/v1/widget/accounts/huggingface?": { name: "Hugging Face", jobs: [] },
      "https://apply.workable.com/api/v1/widget/accounts/acme?": { name: "Acme", jobs: [job] },
    });

    const outcome = await workableSource.fetchJobs(context(["acme", "gone"]));
    expect(outcome.results.map((r) => [r.feed, r.complete, r.jobs.length])).toEqual([
      ["huggingface", true, 0],
      ["acme", true, 1],
    ]);
    expect(outcome.results[1]?.jobs[0]).toMatchObject({
      externalId: "ABC123",
      company: "ACME",
      workplace: "remote",
      locations: ["Lisbon, Lisbon, Portugal"],
      categoryHints: ["Engineering", "Web"],
      employmentTypeHints: ["Full-time"],
      postedAt: "2026-11-01",
    });
    expect(outcome.errors).toEqual([expect.objectContaining({ feed: "gone", gone: true })]);
  });
});

describe("Recruitee adapter", () => {
  it("maps work mode, salary and dates, and skips unpublished offers", async () => {
    const offer = {
      id: 7,
      title: "Backend Developer",
      careers_url: "https://careers.acme.com/o/backend-developer",
      status: "published",
      description: "<p>Go</p>",
      requirements: "<p>5 years</p>",
      remote: false,
      hybrid: true,
      department: "Engineering",
      employment_type_code: "fulltime_permanent",
      locations: [{ city: "Amsterdam", country: "Netherlands" }],
      salary: { min: "60000", max: "80000", currency: "EUR", period: "year" },
      published_at: "2026-11-06 16:23:53 UTC",
    };
    stubFetch({
      "https://acme.recruitee.com/api/offers/": { offers: [offer, { ...offer, id: 8, status: "draft" }] },
      "https://channable.recruitee.com/": { offers: [] },
      "https://hostaway.recruitee.com/": { offers: [] },
      "https://bunq.recruitee.com/": { offers: [] },
    });

    const outcome = await recruiteeSource.fetchJobs(context(["acme"]));
    expect(outcome.errors).toEqual([]);
    const acme = outcome.results.find((r) => r.feed === "acme");
    expect(acme?.jobs).toHaveLength(1);
    expect(acme?.jobs[0]).toMatchObject({
      externalId: "7",
      workplace: "hybrid",
      descriptionHtml: "<p>Go</p><p>5 years</p>",
      locations: ["Amsterdam, Netherlands"],
      employmentTypeHints: ["fulltime permanent"],
      salary: { min: 60000, max: 80000, currency: "EUR", period: "year" },
      postedAt: "2026-11-06T16:23:53.000Z",
    });
  });

  it("parses its date format", () => {
    expect(recruiteeDate("2026-11-06 16:23:53 UTC")).toBe("2026-11-06T16:23:53.000Z");
    expect(recruiteeDate("not a date")).toBeNull();
    expect(recruiteeDate(null)).toBeNull();
  });
});
