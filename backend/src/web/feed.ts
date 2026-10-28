import type { Job } from "../domain/job.js";
import { escapeHtml } from "./seo.js";

/**
 * RSS 2.0 for a search: "tell me about new roles" without an account. The
 * feed URL takes the same filters as GET /api/jobs (see api/jobs.ts).
 */

/** Roles per feed: readers poll often, so only the newest matter. */
export const FEED_MAX_ITEMS = 50;

/**
 * Drops characters XML 1.0 forbids (third-party text sometimes carries
 * them) and collapses whitespace, then escapes.
 */
function text(value: string): string {
  return escapeHtml(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/\s+/g, " ").trim());
}

/** RFC 822 date, as RSS requires; null if the stored date doesn't parse. */
function rfc822(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toUTCString();
}

function salaryText(job: Job): string | null {
  if (!job.salary) return null;
  const { min, max, currency, period } = job.salary;
  const amount = (n: number) => n.toLocaleString("en-US");
  const range = min !== null && max !== null && min !== max ? `${amount(min)}–${amount(max)}` : amount((min ?? max) as number);
  return `${currency ? `${currency} ` : ""}${range} per ${period}`;
}

/** "Acme · Remote - Worldwide · USD 150,000–180,000 per year", plain text. */
function itemDescription(job: Job): string {
  return [job.company, ...job.locations.slice(0, 3), salaryText(job)].filter(Boolean).join(" · ");
}

export interface FeedSearch {
  /** The search as URL parameters (filters only, no paging). */
  params: URLSearchParams;
  /** Human-readable parts of the search, e.g. ["\"react\"", "remote"]. */
  terms: string[];
}

export function renderJobsFeed(jobs: Job[], search: FeedSearch, siteUrl: string, now: Date): string {
  const query = search.params.toString();
  const pageUrl = query ? `${siteUrl}/?${query}` : `${siteUrl}/`;
  const selfUrl = `${siteUrl}/api/jobs/feed.xml${query ? `?${query}` : ""}`;
  const title = search.terms.length ? `job-radar: ${search.terms.join(" · ")}` : "job-radar: all open roles";

  const items = jobs.map((job) => {
    const pubDate = rfc822(job.postedAt ?? job.firstSeenAt);
    return [
      "    <item>",
      `      <title>${text(`${job.title} at ${job.company}`)}</title>`,
      `      <link>${text(`${siteUrl}/jobs/${encodeURIComponent(job.id)}`)}</link>`,
      `      <guid isPermaLink="false">${text(job.id)}</guid>`,
      pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
      `      <description>${text(itemDescription(job))}</description>`,
      "    </item>",
    ]
      .filter((line) => line !== null)
      .join("\n");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    `    <title>${text(title)}</title>`,
    `    <link>${text(pageUrl)}</link>`,
    `    <atom:link href="${text(selfUrl)}" rel="self" type="application/rss+xml" />`,
    `    <description>${text(`The newest open roles on job-radar matching this search.`)}</description>`,
    `    <lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
