import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditNet, createVerifier, parsePostingRef, refFromAtsRow } from "../src/accuracy/verify.js";
import { openDb } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { normalizeJob } from "../src/normalize/index.js";
import {
  descriptionHtml,
  fetchAllPostings,
  fetchBoard,
  smartRecruitersSource,
  toRawJob,
  type SmartRecruitersPosting,
} from "../src/sources/smartrecruiters.js";

const API = "https://api.smartrecruiters.com/v1/companies";
const board = { token: "Acme", name: "Acme" };

function posting(id: string, overrides: Partial<SmartRecruitersPosting> = {}): SmartRecruitersPosting {
  return {
    id,
    name: "Senior Backend Engineer",
    releasedDate: "2026-10-20T10:00:00.000Z",
    location: { city: "Lisbon", region: "11", country: "pt", remote: false, hybrid: true, fullLocation: "Lisbon, Portugal" },
    department: { id: "1", label: "Platform" },
    function: { id: "information_technology", label: "Information Technology" },
    typeOfEmployment: { id: "permanent", label: "Full-time" },
    experienceLevel: { id: "mid_senior_level", label: "Mid-Senior Level" },
    ...overrides,
  };
}

/** Stubs fetch with a handler by URL; anything unhandled is a 404. */
function stubFetch(handler: (url: string) => unknown) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      urls.push(url);
      const body = handler(url);
      if (body === undefined) return new Response("not found", { status: 404 });
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body));
    }),
  );
  return urls;
}

/** A board's list endpoint, served in pages from `postings`. */
function listPages(postings: SmartRecruitersPosting[], url: string): unknown {
  const match = /\/postings\?limit=(\d+)&offset=(\d+)$/.exec(url);
  if (!match) return undefined;
  const [limit, offset] = [Number(match[1]), Number(match[2])];
  return { offset, limit, totalFound: postings.length, content: postings.slice(offset, offset + limit) };
}

describe("SmartRecruiters mapping", () => {
  it("maps location, work mode, department, employment type and experience", () => {
    const raw = toRawJob(board, posting("744000150417468"), { html: "<p>Go and Kubernetes</p>" });
    expect(raw).toMatchObject({
      externalId: "744000150417468",
      url: "https://jobs.smartrecruiters.com/Acme/744000150417468",
      locations: ["Lisbon, Portugal"],
      workplace: "hybrid",
      categoryHints: ["Platform", "Information Technology"],
      employmentTypeHints: ["Full-time"],
      // "Mid-Senior Level" says nothing: the title decides.
      seniorityHints: [],
      postedAt: "2026-10-20T10:00:00.000Z",
    });
    expect(normalizeJob("smartrecruiters", "Acme", raw)).toMatchObject({
      workplace: "hybrid",
      allowedCountries: ["PT"],
      category: "software-development",
      seniority: "senior",
      employmentType: "full_time",
    });
  });

  it("reads the remote flag, and on-site only when both flags are explicitly off", () => {
    expect(toRawJob(board, posting("1", { location: { remote: true, hybrid: false, fullLocation: "Austin, TX, United States" } }), null).workplace).toBe("remote");
    expect(toRawJob(board, posting("2", { location: { remote: false, hybrid: false, city: "Pune", country: "in" } }), null)).toMatchObject({
      workplace: "onsite",
      locations: ["Pune, IN"],
    });
    expect(toRawJob(board, posting("3", { location: { fullLocation: "Berlin, Germany" } }), null).workplace).toBeNull();
  });

  it("passes explicit experience levels as seniority hints", () => {
    const raw = toRawJob(board, posting("1", { name: "Software Engineer", experienceLevel: { id: "entry_level", label: "Entry Level" } }), null);
    expect(raw.seniorityHints).toEqual(["Entry Level"]);
    expect(normalizeJob("smartrecruiters", "Acme", raw).seniority).toBe("junior");
  });

  it("joins the job ad sections, the role before the company blurb", () => {
    const html = descriptionHtml({
      jobAd: {
        sections: {
          companyDescription: { title: "Company Description", text: "<p>We make tools.</p>" },
          jobDescription: { title: "Job Description", text: "<p>Build APIs.</p>" },
          qualifications: { title: "Qualifications", text: "" },
        },
      },
    });
    expect(html).toBe("<h3>Job Description</h3><p>Build APIs.</p><h3>Company Description</h3><p>We make tools.</p>");
    expect(descriptionHtml({})).toBeNull();
  });
});

describe("SmartRecruiters adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pages through the whole board", async () => {
    const all = Array.from({ length: 250 }, (_, i) => posting(String(1000 + i)));
    const urls = stubFetch((url) => listPages(all, url));
    const postings = await fetchAllPostings("Acme");
    expect(postings).toHaveLength(250);
    expect(urls).toEqual([0, 100, 200].map((offset) => `${API}/Acme/postings?limit=100&offset=${offset}`));
  });

  it("fails a board whose pages don't add up to the reported total", async () => {
    stubFetch((url) => (url.includes("offset=0") ? { totalFound: 150, content: [posting("1")] } : { totalFound: 150, content: [] }));
    await expect(fetchAllPostings("Acme")).rejects.toThrow("read 1 of 150");
  });

  it("fetches descriptions only for postings without one, within the budget", async () => {
    const all = [posting("1"), posting("2"), posting("3"), posting("4")];
    const urls = stubFetch((url) => {
      if (url.endsWith("/postings/2")) return { jobAd: { sections: { jobDescription: { text: "<p>Two</p>" } } } };
      if (url.endsWith("/postings/3")) return new Response("forbidden", { status: 403 });
      return listPages(all, url);
    });
    const budget = { left: 2 };
    const { jobs } = await fetchBoard(board, budget, { storedDescription: (id) => (id === "1" ? "Stored one" : null) });

    // 1 has a stored description; 2 and 3 use the budget; 4 waits for a later run.
    expect(urls.filter((u) => /\/postings\/\d+$/.test(u))).toEqual([`${API}/Acme/postings/2`, `${API}/Acme/postings/3`]);
    expect(budget.left).toBeLessThanOrEqual(0);
    expect(jobs.map((j) => [j.externalId, j.descriptionHtml ?? null, j.descriptionText ?? null])).toEqual([
      ["1", null, "Stored one"],
      ["2", "<p>Two</p>", null],
      // A failed detail keeps the job, without a description.
      ["3", null, null],
      ["4", null, null],
    ]);
  });

  it("keeps only the listed functions of a filtered board and counts the rest as skipped", async () => {
    const all = [posting("1"), posting("2", { function: { id: "manufacturing", label: "Manufacturing" } }), posting("3", { function: null })];
    stubFetch((url) => listPages(all, url) ?? { jobAd: {} });
    const { jobs, skipped } = await fetchBoard({ ...board, functions: ["information_technology"] }, { left: 10 });
    expect(jobs.map((j) => j.externalId)).toEqual(["1"]);
    expect(skipped).toBe(2);
  });

  it("reports one complete feed per company and keeps stored descriptions through the pipeline", async () => {
    const all = [posting("1")];
    let detailCalls = 0;
    stubFetch((url) => {
      if (url.endsWith("/postings/1")) {
        detailCalls += 1;
        return { jobAd: { sections: { jobDescription: { text: "<p>Build APIs in Go.</p>" } } } };
      }
      return listPages(all, url);
    });
    vi.spyOn(await import("../src/sources/companies.js"), "SMARTRECRUITERS_BOARDS", "get").mockReturnValue([board]);
    const source = { ...smartRecruitersSource, feeds: ["Acme"] };
    const db = openDb(":memory:");

    await runIngestion(db, [source], { staleAfterDays: 30, now: () => new Date("2026-10-28T10:00:00Z") });
    await runIngestion(db, [source], { staleAfterDays: 30, now: () => new Date("2026-10-28T13:00:00Z") });

    expect(detailCalls).toBe(1);
    const row = db.prepare("SELECT feed, source_rank, description, closed_at FROM jobs WHERE id = 'smartrecruiters:1'").get();
    expect(row).toEqual({ feed: "Acme", source_rank: 0, description: "Build APIs in Go.", closed_at: null });
  });
});

describe("SmartRecruiters verification", () => {
  it("parses posting URLs, with or without a slug", () => {
    expect(parsePostingRef("https://jobs.smartrecruiters.com/BoschGroup/744000158387699-senior-safety-engineer?oga=true")).toEqual({
      provider: "smartrecruiters",
      board: "BoschGroup",
      id: "744000158387699",
    });
    expect(parsePostingRef("https://jobs.smartrecruiters.com/ScalableGmbH/744000146482709")).toEqual({
      provider: "smartrecruiters",
      board: "ScalableGmbH",
      id: "744000146482709",
    });
    expect(parsePostingRef("https://jobs.smartrecruiters.com/BoschGroup")).toBeNull();
    expect(parsePostingRef("https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/ecdfb02b")).toBeNull();
    expect(refFromAtsRow("smartrecruiters", "Acme", "1")).toEqual({ provider: "smartrecruiters", board: "Acme", id: "1" });
  });

  it("classifies by the posting detail's status: 200 open, 404 closed, else unknown", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const id = String(input).split("/").pop();
      if (id === "1") return new Response("{}", { status: 200 });
      if (id === "3") return new Response("", { status: 400 });
      if (id === "4") throw new TypeError("fetch failed");
      return new Response("", { status: 404 });
    });
    const verify = createVerifier(createAuditNet({ fetch: fetch as unknown as typeof globalThis.fetch, minGapMs: 0 }));
    const ref = (id: string) => ({ provider: "smartrecruiters" as const, board: "Acme", id });
    expect(await verify(ref("1"))).toBe("open");
    expect(await verify(ref("2"))).toBe("closed");
    expect(await verify(ref("3"))).toBe("unknown");
    expect(await verify(ref("4"))).toBe("unknown");
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${API}/Acme/postings/1`);
  });
});
