import type { Db } from "../db/index.js";

/**
 * Crawlers and link previews (WhatsApp, LinkedIn, …) don't run JavaScript,
 * so what they see of a page is the HTML the server sends. This module gives
 * them robots.txt, a sitemap of open roles and per-role meta tags.
 */

/** Public base URL when SITE_URL isn't set (see config.ts). */
export const DEFAULT_SITE_URL = "https://radar-de-vagas.fly.dev";

/** The sitemap protocol's per-file limit. */
const SITEMAP_MAX_URLS = 50_000;
const DESCRIPTION_MAX_CHARS = 200;

/** Escapes text for use in HTML/XML content and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The client router's URL for a role (see frontend/src/lib/router.ts). */
function jobUrl(siteUrl: string, id: string): string {
  return `${siteUrl}/jobs/${encodeURIComponent(id)}`;
}

export function robotsTxt(siteUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

/** Home plus one URL per open role (one copy per opening, like the listing). */
export function buildSitemap(db: Db, siteUrl: string): string {
  const rows = db
    .prepare(
      `SELECT id, COALESCE(posted_at, first_seen_at) AS date FROM jobs
       WHERE closed_at IS NULL AND canonical = 1
       ORDER BY date DESC, id
       LIMIT ?`,
    )
    .all(SITEMAP_MAX_URLS - 1) as { id: string; date: string | null }[];

  const urls = [`  <url><loc>${escapeHtml(`${siteUrl}/`)}</loc></url>`];
  for (const row of rows) {
    // W3C date (YYYY-MM-DD); skipped if the stored date isn't ISO.
    const day = row.date && /^\d{4}-\d{2}-\d{2}/.test(row.date) ? row.date.slice(0, 10) : null;
    const lastmod = day ? `<lastmod>${day}</lastmod>` : "";
    urls.push(`  <url><loc>${escapeHtml(jobUrl(siteUrl, row.id))}</loc>${lastmod}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * Memoizes the sitemap for `ttlMs`: it's public and un-rate-limited, so a
 * flood of requests must not turn into a flood of 15k-row queries.
 */
export function cachedSitemap(db: Db, siteUrl: string, ttlMs = 60 * 60_000): () => string {
  let cached: { xml: string; at: number } | null = null;
  return () => {
    const now = Date.now();
    if (!cached || now - cached.at >= ttlMs) cached = { xml: buildSitemap(db, siteUrl), at: now };
    return cached.xml;
  };
}

interface JobMeta {
  id: string;
  title: string;
  company: string;
  locations: string;
  description: string | null;
}

/** An open role's fields for its link preview; undefined if unknown or closed. */
export function findOpenJob(db: Db, id: string): JobMeta | undefined {
  return db
    .prepare("SELECT id, title, company, locations, description FROM jobs WHERE id = ? AND closed_at IS NULL")
    .get(id) as JobMeta | undefined;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** "Acme · Remote - Worldwide. We are hiring …", plain text. */
function summary(job: JobMeta): string {
  let locations: string[] = [];
  try {
    const parsed: unknown = JSON.parse(job.locations);
    if (Array.isArray(parsed)) locations = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // Malformed locations just leave them out.
  }
  const head = [job.company, ...locations.slice(0, 2)].map(oneLine).filter(Boolean).join(" · ");
  // Descriptions are stored as plain text; drop any stray tags anyway.
  const body = job.description ? oneLine(job.description.replace(/<[^>]*>/g, " ")) : "";
  return truncate(body ? `${head}. ${body}` : head, DESCRIPTION_MAX_CHARS);
}

/**
 * index.html with the role's title, description, canonical link and Open
 * Graph/Twitter tags. Everything inserted is escaped: titles and
 * descriptions come from third parties.
 */
export function renderJobPage(template: string, job: JobMeta, siteUrl: string): string {
  const title = `${oneLine(job.title)} at ${oneLine(job.company)} · job-radar`;
  const description = summary(job);
  const url = jobUrl(siteUrl, job.id);
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="job-radar" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join("\n    ");

  // Functions as replacements, so "$&" etc. in the inserted text stay literal.
  return template
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/[ \t]*<meta\s+name="description"[^>]*>\n?/i, "")
    .replace(/<\/head>/i, () => `  ${tags}\n  </head>`);
}
