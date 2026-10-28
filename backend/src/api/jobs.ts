import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import {
  CATEGORIES,
  EMPLOYMENT_TYPES,
  PAY_TIERS,
  SENIORITIES,
  WORKPLACES,
  type Job,
  type JobDetail,
  type PayTier,
  type SalaryPeriod,
} from "../domain/job.js";
import { toSearchKey } from "../normalize/text.js";
import { findSource } from "../sources/index.js";
import { FEED_MAX_ITEMS, renderJobsFeed, type FeedSearch } from "../web/feed.js";
import { DEFAULT_SITE_URL } from "../web/seo.js";

/** `a,b,c` → validated list of enum members. */
function csvOf<T extends string>(values: readonly T[]) {
  return z
    .string()
    .trim()
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as unknown as [T, ...T[]])))
    .optional();
}

const categoryIds = CATEGORIES.map((c) => c.id);

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: csvOf(categoryIds),
  workplace: csvOf(WORKPLACES),
  seniority: csvOf(SENIORITIES),
  type: csvOf(EMPLOYMENT_TYPES),
  tier: csvOf(PAY_TIERS),
  skills: z
    .string()
    .trim()
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20))
    .optional(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "country must be an ISO 3166-1 alpha-2 code")
    .transform((v) => v.toUpperCase())
    .optional(),
  minSalary: z.coerce.number().int().min(0).max(2_000_000).optional(),
  postedWithin: z.coerce.number().int().min(1).max(365).optional(),
  source: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).max(100).optional(),
  /** Only jobs whose Apply goes to the employer's own posting. */
  direct: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type JobsQuery = z.infer<typeof querySchema>;

interface JobRow {
  id: string;
  source: string;
  external_id: string;
  title: string;
  company: string;
  company_logo: string | null;
  url: string;
  locations: string;
  workplace: Job["workplace"];
  allowed_countries: string | null;
  category: Job["category"];
  seniority: Job["seniority"];
  employment_type: Job["employmentType"];
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  salary_min_usd_year: number | null;
  skills: string;
  tags: string;
  description?: string | null;
  posted_at: string | null;
  expires_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  tier: PayTier | null;
  source_rank: number;
  apply_url: string | null;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    source: row.source,
    sourceName: findSource(row.source)?.name ?? row.source,
    externalId: row.external_id,
    title: row.title,
    company: row.company,
    companyLogo: row.company_logo,
    companyTier: row.tier,
    url: row.url,
    // ATS postings are the employer's own; board listings only when resolved.
    applyUrl: row.apply_url ?? row.url,
    applyDirect: row.source_rank === 0 || row.apply_url !== null,
    locations: parseJsonArray(row.locations),
    workplace: row.workplace,
    allowedCountries: row.allowed_countries ? parseJsonArray(row.allowed_countries) : null,
    category: row.category,
    seniority: row.seniority,
    employmentType: row.employment_type,
    salary:
      row.salary_min !== null || row.salary_max !== null
        ? { min: row.salary_min, max: row.salary_max, currency: row.salary_currency, period: row.salary_period ?? "year" }
        : null,
    salaryMinUsdYear: row.salary_min_usd_year,
    skills: parseJsonArray(row.skills),
    tags: parseJsonArray(row.tags),
    postedAt: row.posted_at,
    expiresAt: row.expires_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Escapes LIKE metacharacters so user input can't alter the pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function inList(column: string, prefix: string, values: readonly string[], params: Record<string, unknown>): string {
  const names = values.map((v, i) => {
    params[`${prefix}${i}`] = v;
    return `@${prefix}${i}`;
  });
  return `${column} IN (${names.join(", ")})`;
}

const LIST_COLUMNS = `
  j.id, j.source, j.external_id, j.title, j.company, j.company_logo, j.url, j.locations, j.workplace,
  j.allowed_countries, j.category, j.seniority, j.employment_type, j.salary_min, j.salary_max,
  j.salary_currency, j.salary_period, j.salary_min_usd_year, j.skills, j.tags, j.posted_at, j.expires_at,
  j.first_seen_at, j.last_seen_at, c.tier, j.source_rank, j.apply_url`;

/** Builds the WHERE clause shared by the listing and its count. */
export function buildJobFilter(query: JobsQuery, now: Date): { where: string; params: Record<string, unknown> } {
  const conditions = ["j.closed_at IS NULL"];
  const params: Record<string, unknown> = {};

  // Filtering by source shows that source's own copies; otherwise one copy
  // per opening (see recomputeCanonical).
  if (query.source) {
    conditions.push("j.source = @source");
    params.source = query.source;
  } else {
    conditions.push("j.canonical = 1");
  }

  if (query.q) {
    // Every word must match (AND), each spelling-insensitively.
    query.q
      .split(/\s+/)
      .map(toSearchKey)
      .filter(Boolean)
      .slice(0, 8)
      .forEach((word, i) => {
        conditions.push(`j.search_text LIKE @q${i} ESCAPE '\\'`);
        params[`q${i}`] = `%${escapeLike(word)}%`;
      });
  }
  if (query.category?.length) conditions.push(inList("j.category", "cat", query.category, params));
  if (query.workplace?.length) conditions.push(inList("j.workplace", "wp", query.workplace, params));
  if (query.seniority?.length) conditions.push(inList("j.seniority", "sen", query.seniority, params));
  if (query.type?.length) conditions.push(inList("j.employment_type", "type", query.type, params));
  if (query.tier?.length) conditions.push(inList("c.tier", "tier", query.tier, params));
  if (query.skills?.length) {
    const names = query.skills.map((skill, i) => {
      params[`skill${i}`] = skill;
      return `@skill${i}`;
    });
    conditions.push(`EXISTS (SELECT 1 FROM json_each(j.skills) s WHERE s.value IN (${names.join(", ")}))`);
  }
  if (query.country) {
    // Remote jobs with no detected restriction are open to everyone; an
    // on-site/hybrid job must actually be located in that country.
    conditions.push(
      `(EXISTS (SELECT 1 FROM json_each(j.allowed_countries) ac WHERE ac.value = @country)
        OR (j.workplace = 'remote' AND j.allowed_countries IS NULL))`,
    );
    params.country = query.country;
  }
  if (query.minSalary !== undefined) {
    conditions.push("j.salary_min_usd_year >= @minSalary");
    params.minSalary = query.minSalary;
  }
  if (query.postedWithin !== undefined) {
    conditions.push("COALESCE(j.posted_at, j.first_seen_at) >= @postedAfter");
    params.postedAfter = new Date(now.getTime() - query.postedWithin * 86_400_000).toISOString();
  }
  if (query.direct) conditions.push("(j.source_rank = 0 OR j.apply_url IS NOT NULL)");
  if (query.company) {
    conditions.push("j.company_key = @company");
    params.company = query.company;
  }

  return { where: conditions.join(" AND "), params };
}

/** The filter parameters (not paging) that a feed and its search page share. */
const FILTER_KEYS = Object.keys(querySchema.shape).filter((key) => key !== "page" && key !== "pageSize");

/** The search as given (normalized) plus a short human-readable summary. */
function describeSearch(raw: Record<string, unknown>, query: JobsQuery): FeedSearch {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  const categoryName = (id: string) => CATEGORIES.find((c) => c.id === id)?.name ?? id;
  const terms = [
    query.q ? `"${query.q}"` : null,
    ...(query.category ?? []).map(categoryName),
    ...(query.seniority ?? []),
    ...(query.workplace ?? []),
    ...(query.type ?? []).map((t) => t.replace("_", "-")),
    ...(query.skills ?? []),
    ...(query.tier ?? []).map((t) => `tier ${t}`),
    query.country ? `open to ${query.country}` : null,
    query.minSalary !== undefined ? `from $${query.minSalary.toLocaleString("en-US")}/year` : null,
    query.postedWithin !== undefined ? `last ${query.postedWithin} days` : null,
    query.company ? `at ${query.company}` : null,
    query.source ? `from ${findSource(query.source)?.name ?? query.source}` : null,
    query.direct ? "direct apply" : null,
  ];
  return { params, terms: terms.filter((t): t is string => Boolean(t)) };
}

const FROM_JOBS = "FROM jobs j LEFT JOIN companies c ON c.company_key = j.company_key";

export function createJobsRouter(db: Db, siteUrl = DEFAULT_SITE_URL): Router {
  const router = Router();

  const parseQuery = (req: Request, res: Response): JobsQuery | null => {
    const parsed = querySchema.safeParse(req.query);
    if (parsed.success) return parsed.data;
    res.status(400).json({ error: "Invalid query parameters", details: z.flattenError(parsed.error).fieldErrors });
    return null;
  };

  router.get("/", (req, res) => {
    const query = parseQuery(req, res);
    if (!query) return;
    const now = new Date();
    const { where, params } = buildJobFilter(query, now);

    // Same 7-day rule as the stats endpoint, but scoped to the filters.
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(COALESCE(j.posted_at, j.first_seen_at) >= @weekAgo) AS newLast7Days
         ${FROM_JOBS} WHERE ${where}`,
      )
      .get({ ...params, weekAgo }) as { total: number; newLast7Days: number | null };
    const total = counts.total;
    const rows = db
      .prepare(
        `SELECT ${LIST_COLUMNS} ${FROM_JOBS} WHERE ${where}
         ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC, j.id
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize }) as JobRow[];

    res.json({
      jobs: rows.map(rowToJob),
      total,
      newLast7Days: counts.newLast7Days ?? 0,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: query.page * query.pageSize < total,
    });
  });

  // Declared before /:id, which would otherwise take "feed.xml" as an id.
  router.get("/feed.xml", (req, res) => {
    const query = parseQuery(req, res);
    if (!query) return;
    const now = new Date();
    const { where, params } = buildJobFilter(query, now);
    const rows = db
      .prepare(
        `SELECT ${LIST_COLUMNS} ${FROM_JOBS} WHERE ${where}
         ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC, j.id
         LIMIT @limit`,
      )
      .all({ ...params, limit: FEED_MAX_ITEMS }) as JobRow[];

    const xml = renderJobsFeed(rows.map(rowToJob), describeSearch(req.query as Record<string, unknown>, query), siteUrl, now);
    // Readers poll; ingestion runs twice a day, so a short shared cache is plenty fresh.
    res.setHeader("Cache-Control", "public, max-age=900");
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.send(xml);
  });

  router.get("/:id", (req, res) => {
    const row = db
      .prepare(
        `SELECT ${LIST_COLUMNS}, j.description, j.closed_at, j.fingerprint, j.apply_method
         FROM jobs j LEFT JOIN companies c ON c.company_key = j.company_key WHERE j.id = ?`,
      )
      .get(req.params.id) as (JobRow & { closed_at: string | null; fingerprint: string; apply_method: string | null }) | undefined;
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const alsoOn = db
      .prepare("SELECT source, url FROM jobs WHERE fingerprint = ? AND id != ? AND closed_at IS NULL ORDER BY source_rank")
      .all(row.fingerprint, row.id) as { source: string; url: string }[];

    const detail: JobDetail & {
      closedAt: string | null;
      applyMethod: string | null;
      alsoOn: { source: string; sourceName: string; url: string }[];
    } = {
      ...rowToJob(row),
      description: row.description ?? null,
      closedAt: row.closed_at,
      applyMethod: row.source_rank === 0 ? "source" : row.apply_method,
      alsoOn: alsoOn.map((d) => ({ ...d, sourceName: findSource(d.source)?.name ?? d.source })),
    };
    res.json(detail);
  });

  return router;
}
