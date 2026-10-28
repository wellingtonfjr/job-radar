import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";
import { runIngestion } from "../src/ingestion/pipeline.js";
import { cachedSitemap } from "../src/web/seo.js";
import { fakeSource, rawJob } from "./helpers.js";

const SITE = "https://jobs.example.com";
const DEFAULT_TITLE = "<title>job-radar · Open roles, verified daily</title>";
const DEFAULT_DESCRIPTION = '<meta name="description" content="Real, current job openings." />';

describe("SEO and link previews", () => {
  let db: Db;
  let dist: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    db = openDb(":memory:");
    const ats = fakeSource("greenhouse");
    ats.respond({
      results: [
        {
          feed: "acme",
          complete: true,
          jobs: [
            rawJob({
              externalId: "1",
              title: "Senior Front-End Engineer",
              descriptionHtml: "<p>Build the <b>React</b> app.</p><p>TypeScript required.</p>",
              postedAt: "2026-10-20T12:00:00Z",
            }),
            rawJob({ externalId: "2", title: "Product Designer", postedAt: "2026-10-18T00:00:00Z" }),
            rawJob({ externalId: "a/b c", title: "Data Engineer", postedAt: "2026-10-15T00:00:00Z" }),
          ],
        },
      ],
      errors: [],
    });
    // Pinned: the fixed dates above must not age into evergreen postings.
    await runIngestion(db, [ats], { staleAfterDays: 30, now: () => new Date("2026-10-28T00:00:00Z") });
    db.prepare("UPDATE jobs SET closed_at = '2026-10-25T00:00:00Z' WHERE id = 'greenhouse:2'").run();
    // Titles come from third parties: this one tries to break out of the HTML.
    db.prepare("UPDATE jobs SET title = ?, company = ? WHERE id = 'greenhouse:a/b c'").run(
      `</title><script>alert(1)</script>"><img src=x onerror=alert(2)>`,
      `Evil & "Co" $& $'`,
    );

    dist = fs.mkdtempSync(path.join(os.tmpdir(), "job-radar-seo-"));
    fs.writeFileSync(
      path.join(dist, "index.html"),
      `<!doctype html>\n<html>\n  <head>\n    ${DEFAULT_DESCRIPTION}\n    ${DEFAULT_TITLE}\n  </head>\n  <body><div id="root"></div></body>\n</html>`,
    );
    server = createApp(db, { staticDir: dist, siteUrl: SITE }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it("serves robots.txt allowing everything and pointing to the sitemap", async () => {
    const res = await fetch(`${base}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain("User-agent: *\nAllow: /");
    expect(body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("lists the home page and open roles in the sitemap", async () => {
    const res = await fetch(`${base}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/xml/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.text();
    expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(body).toContain(`<url><loc>${SITE}/</loc></url>`);
    expect(body).toContain(`<url><loc>${SITE}/jobs/greenhouse%3A1</loc><lastmod>2026-10-20</lastmod></url>`);
    // Ids are URL-encoded like the client router does.
    expect(body).toContain(`<loc>${SITE}/jobs/greenhouse%3Aa%2Fb%20c</loc>`);
    // Closed roles are left out.
    expect(body).not.toContain("greenhouse%3A2");
  });

  it("caches the generated sitemap instead of querying on every request", () => {
    const cacheDb = openDb(":memory:");
    try {
      const sitemap = cachedSitemap(cacheDb, SITE, 60_000);
      const first = sitemap();
      cacheDb
        .prepare(
          `INSERT INTO jobs (id, source, feed, external_id, title, company, company_key, url, workplace, category,
             search_text, fingerprint, source_rank, first_seen_at, last_seen_at)
           VALUES ('x:1', 'x', 'f', '1', 'T', 'C', 'c', 'https://e.com', 'remote', 'other', 't', 'fp', 0, '2026-10-01', '2026-10-01')`,
        )
        .run();
      expect(sitemap()).toBe(first);
      expect(cachedSitemap(cacheDb, SITE, 60_000)()).toContain("/jobs/x%3A1");
    } finally {
      cacheDb.close();
    }
  });

  it("injects the role's title, description and preview tags into its page", async () => {
    const res = await fetch(`${base}/jobs/greenhouse%3A1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    const html = await res.text();
    const title = "Senior Front-End Engineer at Acme · job-radar";
    const description = "Acme · Remote - Worldwide. Build the React app. TypeScript required.";
    const url = `${SITE}/jobs/greenhouse%3A1`;
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta name="description" content="${description}" />`);
    expect(html).toContain(`<link rel="canonical" href="${url}" />`);
    expect(html).toContain(`<meta property="og:title" content="${title}" />`);
    expect(html).toContain(`<meta property="og:description" content="${description}" />`);
    expect(html).toContain(`<meta property="og:url" content="${url}" />`);
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:site_name" content="job-radar" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    // The defaults are replaced, not duplicated, and the app still mounts.
    expect(html).not.toContain(DEFAULT_TITLE);
    expect(html).not.toContain(DEFAULT_DESCRIPTION);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('<div id="root"></div>');
  });

  it.each([
    ["an unknown role", "/jobs/greenhouse%3A999"],
    ["a closed role", "/jobs/greenhouse%3A2"],
    ["the home page", "/"],
  ])("serves the default meta for %s", async (_label, pagePath) => {
    const res = await fetch(`${base}${pagePath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const html = await res.text();
    expect(html).toContain(DEFAULT_TITLE);
    expect(html).toContain(DEFAULT_DESCRIPTION);
    expect(html).not.toContain("og:title");
    expect(html).not.toContain("canonical");
  });

  it("escapes third-party text inserted into the page", async () => {
    const html = await (await fetch(`${base}/jobs/greenhouse%3Aa%2Fb%20c`)).text();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain(
      "<title>&#60;/title&#62;&#60;script&#62;alert(1)&#60;/script&#62;&#34;&#62;&#60;img src=x onerror=alert(2)&#62; at Evil &#38; &#34;Co&#34; $&#38; $&#39; · job-radar</title>",
    );
    expect(html).toContain(`<link rel="canonical" href="${SITE}/jobs/greenhouse%3Aa%2Fb%20c" />`);
  });
});
