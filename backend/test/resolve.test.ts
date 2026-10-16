import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { boardTokenCandidates, matchPosting, titleKey, type Board } from "../src/resolve/atsDiscovery.js";
import { remotiveApplyLink } from "../src/resolve/listingPages.js";
import type { ResolverNet } from "../src/resolve/net.js";
import { cleanUrl, extractPostingLinks, isPostingUrl } from "../src/resolve/postingUrls.js";
import { resolveApplyLinks } from "../src/resolve/resolver.js";
import { fakeSource, rawJob } from "./helpers.js";

/** A fake network: JSON/text by exact URL; everything listed is reachable. */
function fakeNet(routes: { json?: Record<string, unknown>; text?: Record<string, string>; dead?: string[] } = {}) {
  const calls: string[] = [];
  const net: ResolverNet = {
    async json<T>(url: string) {
      calls.push(url);
      return (routes.json?.[url] as T | undefined) ?? null;
    },
    async text(url) {
      calls.push(url);
      return routes.text?.[url] ?? null;
    },
    async reachable(url) {
      return !routes.dead?.includes(url);
    },
  };
  return { net, calls };
}

describe("posting URLs", () => {
  it("accepts specific ATS postings only", () => {
    expect(isPostingUrl("https://jobs.lever.co/acme/0b9c6d4e-1234-4abc-9def-0123456789ab")).toBe(true);
    expect(isPostingUrl("https://boards.greenhouse.io/acme/jobs/123456")).toBe(true);
    expect(isPostingUrl("https://acme.com/careers?gh_jid=42")).toBe(true);
    expect(isPostingUrl("https://jobs.lever.co/acme")).toBe(false);
    expect(isPostingUrl("https://acme.com/careers")).toBe(false);
  });

  it("strips tracking parameters but keeps job ids", () => {
    expect(cleanUrl("https://acme.com/careers?gh_jid=42&utm_source=remotive&ref=x#apply")).toBe("https://acme.com/careers?gh_jid=42");
    expect(cleanUrl("http://insecure.example/job")).toBeNull();
    expect(cleanUrl("not a url")).toBeNull();
  });

  it("extracts posting links from description HTML and text", () => {
    const html = `<p>Apply <a href="https://jobs.ashbyhq.com/acme/0b9c6d4e-1234-4abc-9def-0123456789ab?utm_source=x">here</a>
      or https://apply.workable.com/acme/j/ABC123/. See https://acme.com/about.</p>`;
    expect(extractPostingLinks(html)).toEqual([
      "https://jobs.ashbyhq.com/acme/0b9c6d4e-1234-4abc-9def-0123456789ab",
      "https://apply.workable.com/acme/j/ABC123/",
    ]);
  });
});

describe("ATS discovery helpers", () => {
  it("derives board token candidates", () => {
    expect(boardTokenCandidates("Lemon.io")).toEqual(["lemonio", "lemon-io", "lemon"]);
    expect(boardTokenCandidates("Proxima Fusion GmbH")).toEqual(["proximafusion", "proxima-fusion"]);
  });

  it("ignores gender and work-mode notes but keeps real qualifiers", () => {
    expect(titleKey("Backend Engineer (m/w/d)")).toBe(titleKey("Backend Engineer"));
    expect(titleKey("Backend Engineer (Remote, EU)")).toBe(titleKey("Backend Engineer - Remote"));
    expect(titleKey("Solutions Engineer - French Speaker")).not.toBe(titleKey("Solutions Engineer - German Speaker"));
    expect(titleKey("Entrepreneur in Residence (Intern)")).not.toBe(titleKey("Entrepreneur in Residence"));
  });

  it("matches one posting, accepts per-city duplicates, rejects ambiguity", () => {
    const board: Board = {
      provider: "ashby",
      token: "acme",
      companyName: null,
      jobs: [
        { title: "Data Engineer", url: "https://jobs.ashbyhq.com/acme/1" },
        { title: "Data Engineer", url: "https://jobs.ashbyhq.com/acme/2" },
        { title: "Designer (Remote)", url: "https://jobs.ashbyhq.com/acme/3" },
        { title: "Designer - Remote", url: "https://jobs.ashbyhq.com/acme/4" },
      ],
    };
    expect(matchPosting(board, "Data Engineer (f/m/x)")).toBe("https://jobs.ashbyhq.com/acme/1");
    expect(matchPosting(board, "Designer")).toBeNull();
    expect(matchPosting(board, "Recruiter")).toBeNull();
  });
});

describe("remotiveApplyLink", () => {
  it("reads the employer link from the public page", async () => {
    const page = `<a class="x" href="https://remotive.com/other">Apply</a>
      <a role="button" href="https://acme.com/jobs/42?utm_source=remotive&amp;utm_medium=job_ad">Apply for this position</a>`;
    const { net } = fakeNet({ text: { "https://remotive.com/job/1": page } });
    expect(await remotiveApplyLink(net, "https://remotive.com/job/1")).toBe("https://acme.com/jobs/42");
  });

  it("ignores links back to Remotive itself", async () => {
    const { net } = fakeNet({ text: { "https://remotive.com/job/1": `<a href="https://remotive.com/join">Apply for this position</a>` } });
    expect(await remotiveApplyLink(net, "https://remotive.com/job/1")).toBeNull();
  });
});

describe("resolveApplyLinks", () => {
  const NOW = new Date("2026-10-15T12:00:00Z");
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  async function ingest(source: ReturnType<typeof fakeSource>, jobs: Parameters<typeof rawJob>[0][]) {
    source.respond({ results: [{ feed: "all", complete: true, jobs: jobs.map(rawJob) }], errors: [] });
    await runIngestion(db, [source], { staleAfterDays: 30, force: true, now: () => NOW });
  }

  function applyRow(id: string) {
    return db.prepare("SELECT apply_url, apply_method FROM jobs WHERE id = ?").get(id);
  }

  it("uses a description link, then Remotive's page, then the company's discovered board", async () => {
    const board = "https://api.ashbyhq.com/posting-api/job-board/globex";
    const { net } = fakeNet({
      json: { [board]: { jobs: [{ title: "Platform Engineer", jobUrl: "https://jobs.ashbyhq.com/globex/abc" }] } },
      text: { "https://remotive.com/jobs/2": `<a href="https://initech.com/apply/7">Apply for this position</a>` },
    });
    await ingest(fakeSource("remotive", "aggregator"), [
      { externalId: "1", company: "Acme", descriptionHtml: `<a href="https://jobs.lever.co/acme/0b9c6d4e-1234-4abc-9def-0123456789ab">Apply</a>` },
      { externalId: "2", company: "Initech", title: "Analyst", url: "https://remotive.com/jobs/2" },
      { externalId: "3", company: "Globex", title: "Platform Engineer (Remote)" },
      { externalId: "4", company: "Hooli", title: "Unknown Role" },
    ]);

    const summary = await resolveApplyLinks(db, net, { now: NOW });
    expect(summary.resolved).toMatchObject({ description: 1, "listing-page": 1, "ats-discovery": 1 });
    expect(summary.unresolved).toBe(1);
    expect(applyRow("remotive:1")).toEqual({ apply_url: "https://jobs.lever.co/acme/0b9c6d4e-1234-4abc-9def-0123456789ab", apply_method: "description" });
    expect(applyRow("remotive:2")).toEqual({ apply_url: "https://initech.com/apply/7", apply_method: "listing-page" });
    expect(applyRow("remotive:3")).toEqual({ apply_url: "https://jobs.ashbyhq.com/globex/abc", apply_method: "ats-discovery" });
    expect(applyRow("remotive:4")).toEqual({ apply_url: null, apply_method: null });
    expect(db.prepare("SELECT provider, token FROM ats_boards WHERE company_key = 'globex'").get()).toEqual({ provider: "ashby", token: "globex" });
  });

  it("prefers an ingested ATS copy and never uses links that no longer load", async () => {
    const ats = fakeSource("greenhouse");
    await ingest(ats, [{ externalId: "9", title: "Data Engineer", url: "https://boards.greenhouse.io/acme/jobs/9" }]);
    const dead = "https://jobs.lever.co/hooli/0b9c6d4e-1234-4abc-9def-0123456789ab";
    // Same opening on a board, shown via the `source` filter (non-canonical) — plus a dead link.
    await ingest(fakeSource("agg", "aggregator"), [
      { externalId: "1", title: "Data Engineer" },
      { externalId: "2", company: "Hooli", title: "Recruiter", descriptionHtml: `<a href="${dead}">x</a>` },
    ]);
    db.exec("UPDATE jobs SET canonical = 1");
    const { net } = fakeNet({ dead: [dead] });

    await resolveApplyLinks(db, net, { now: NOW });
    expect(applyRow("agg:1")).toEqual({ apply_url: "https://boards.greenhouse.io/acme/jobs/9", apply_method: "ats-match" });
    expect(applyRow("agg:2")).toEqual({ apply_url: null, apply_method: null });
  });

  it("caches board discovery per company and respects the budget", async () => {
    const { net, calls } = fakeNet();
    await ingest(fakeSource("agg", "aggregator"), [
      { externalId: "1", company: "Acme", title: "A" },
      { externalId: "2", company: "Acme", title: "B" },
      { externalId: "3", company: "Globex", title: "C" },
    ]);

    const first = await resolveApplyLinks(db, net, { now: NOW, discoveryBudget: 1 });
    expect(first).toMatchObject({ examined: 2, unresolved: 2, deferred: 1 });
    const acmeCalls = calls.filter((u) => u.includes("acme")).length;
    expect(acmeCalls).toBeGreaterThan(0);

    // Next run: Acme's "no board" is cached; only Globex is searched.
    calls.length = 0;
    const second = await resolveApplyLinks(db, net, { now: NOW, discoveryBudget: 1 });
    expect(second).toMatchObject({ examined: 1, deferred: 0 });
    expect(calls.some((u) => u.includes("acme"))).toBe(false);
  });
});
