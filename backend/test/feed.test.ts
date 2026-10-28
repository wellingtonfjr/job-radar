import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { fakeSource, rawJob } from "./helpers.js";

const SITE = "https://jobs.example";

let db: Db;
let server: Server;
let base: string;

async function getFeed(path: string): Promise<{ status: number; headers: Headers; body: string }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, headers: res.headers, body: await res.text() };
}

/** The text of each `<tag>` directly inside every `<item>`. */
function items(xml: string): Record<string, string>[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) =>
    Object.fromEntries([...(body as string).matchAll(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/g)].map(([, tag, value]) => [tag, value])),
  );
}

beforeAll(async () => {
  db = openDb(":memory:");
  const ats = fakeSource("greenhouse");
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
  // 55 filler roles, older than the named ones, to exercise the 50-item cap.
  const filler = Array.from({ length: 55 }, (_, i) =>
    rawJob({ externalId: `f${i}`, title: `Support Specialist ${i}`, postedAt: daysAgo(10 + i / 100) }),
  );
  ats.respond({
    results: [
      {
        feed: "acme",
        complete: true,
        jobs: [
          rawJob({
            externalId: "1",
            title: "Senior Front-End Engineer",
            locations: ["Remote - Worldwide"],
            salary: { min: 150_000, max: 180_000, currency: "USD", period: "year" },
            postedAt: daysAgo(1),
          }),
          rawJob({
            externalId: "2",
            title: `<script>alert("x")</script> & Co \u0007Designer`,
            company: "Evil ]]> Corp",
            locations: ["Berlin, Germany"],
            workplace: "onsite",
            postedAt: daysAgo(2),
          }),
          rawJob({ externalId: "3", title: "Backend Engineer", postedAt: daysAgo(3) }),
          ...filler,
        ],
      },
    ],
    errors: [],
  });
  await runIngestion(db, [ats], { staleAfterDays: 30 });

  server = createApp(db, { siteUrl: SITE }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

describe("GET /api/jobs/feed.xml", () => {
  it("serves RSS 2.0 with a short public cache", async () => {
    const { status, headers, body } = await getFeed("/api/jobs/feed.xml");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(headers.get("cache-control")).toBe("public, max-age=900");
    expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
    expect(body).toContain("<title>job-radar: all open roles</title>");
    expect(body).toContain(`<link>${SITE}/</link>`);
    expect(body).toMatch(/<lastBuildDate>\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT<\/lastBuildDate>/);
  });

  it("lists the newest 50 roles, newest first", async () => {
    const list = items((await getFeed("/api/jobs/feed.xml")).body);
    expect(list).toHaveLength(50);
    expect(list.slice(0, 3).map((i) => i.guid)).toEqual(["greenhouse:1", "greenhouse:2", "greenhouse:3"]);
    const dates = list.map((i) => Date.parse(i.pubDate as string));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("describes each role with a link to its page", async () => {
    const [first] = items((await getFeed("/api/jobs/feed.xml?q=frontend")).body);
    const job = db.prepare("SELECT posted_at FROM jobs WHERE id = 'greenhouse:1'").get() as { posted_at: string };
    expect(first).toEqual({
      title: "Senior Front-End Engineer at Acme",
      link: `${SITE}/jobs/greenhouse%3A1`,
      guid: "greenhouse:1",
      pubDate: new Date(job.posted_at).toUTCString(),
      description: "Acme · Remote - Worldwide · USD 150,000–180,000 per year",
    });
    expect((await getFeed("/api/jobs/feed.xml?q=frontend")).body).toContain('<guid isPermaLink="false">greenhouse:1</guid>');
  });

  it("applies the same filters as the listing and names the search", async () => {
    const { body } = await getFeed("/api/jobs/feed.xml?workplace=onsite&country=de&page=3");
    expect(items(body).map((i) => i.guid)).toEqual(["greenhouse:2"]);
    expect(body).toContain("<title>job-radar: onsite · open to DE</title>");
    // The search page link keeps the filters but not the paging.
    expect(body).toContain(`<link>${SITE}/?workplace=onsite&#38;country=de</link>`);
  });

  it("escapes third-party text and drops characters XML forbids", async () => {
    const { body } = await getFeed("/api/jobs/feed.xml?workplace=onsite");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("]]>");
    expect(body).not.toContain("\u0007");
    expect(items(body)[0]?.title).toBe(
      "&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; Co Designer at Evil ]]&#62; Corp",
    );
  });

  it("escapes the search terms in the channel title", async () => {
    const { body } = await getFeed(`/api/jobs/feed.xml?q=${encodeURIComponent("<b>&")}`);
    expect(body).toContain("<title>job-radar: &#34;&#60;b&#62;&#38;&#34;</title>");
  });

  it("rejects invalid filters with 400 like the listing", async () => {
    const res = await fetch(`${base}/api/jobs/feed.xml?category=nope&country=Brazil`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: Record<string, unknown> };
    expect(Object.keys(body.details)).toEqual(expect.arrayContaining(["category", "country"]));
  });
});
