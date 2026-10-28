import type { RawJob, Workplace } from "../domain/job.js";
import { errorMessage, getJson } from "./http.js";
import type { FetchOutcome, SourceAdapter } from "./types.js";

/**
 * https://www.getonbrd.com/api-doc.html — Get on Board, a Latin American
 * tech job board. Its public API needs no key and documents no rate limit;
 * the tech categories are read in full (about 700 roles, 12 pages, in
 * October 2026), with a pause between pages. Listings link to the role's
 * page on getonbrd.com, where candidates apply.
 *
 * Remote roles come in two kinds: `fully_remote` (from anywhere) and
 * `remote_local` (from the countries and regions in `location_tenants` /
 * `location_regions`). Hybrid and on-site roles name their cities.
 * Salaries are gross USD per month, as the job pages show them.
 */
interface Ref<A> {
  data: { id: string | number; type: string; attributes?: A } | null;
}

interface RefList<A> {
  data: { id: string | number; type: string; attributes?: A }[];
}

export interface GetOnBrdJob {
  id: string;
  type: string;
  attributes: {
    title: string;
    description_headline?: string | null;
    description?: string | null;
    projects?: string | null;
    functions_headline?: string | null;
    functions?: string | null;
    benefits_headline?: string | null;
    benefits?: string | null;
    desirable_headline?: string | null;
    desirable?: string | null;
    remote_modality?: string | null;
    countries?: string[] | null;
    category_name?: string | null;
    min_salary?: number | null;
    max_salary?: number | null;
    published_at?: number | null;
    company?: Ref<{ name: string; logo?: string | null }>;
    seniority?: Ref<{ name: string; locale_key?: string | null }>;
    modality?: Ref<{ name: string; locale_key?: string | null }>;
    tags?: RefList<{ name: string }>;
    location_cities?: RefList<{ name: string; country?: string | null }>;
    location_regions?: RefList<{ name: string }>;
    location_tenants?: RefList<{ name: string }>;
  };
  links?: { public_url?: string | null };
}

export interface GetOnBrdResponse {
  data: GetOnBrdJob[];
  meta?: { page?: number; per_page?: number; total_pages?: number };
}

const API = "https://www.getonbrd.com/api/v0";
const PER_PAGE = 100;
/** Related resources sent in full instead of as bare ids. */
const EXPAND = ["company", "seniority", "modality", "tags", "location_cities", "location_regions", "location_tenants"];

/**
 * Tech categories (slugs from `GET /api/v0/categories`), each with a hint
 * the classifier understands, used when the title alone is inconclusive.
 */
export const GETONBRD_CATEGORIES: Readonly<Record<string, string>> = {
  programming: "Software Development",
  "sysadmin-devops-qa": "DevOps",
  "data-science-analytics": "Data",
  "machine-learning-ai": "Machine Learning",
  "mobile-developer": "Mobile Developer",
  "design-ux": "Design",
  cybersecurity: "Cybersecurity",
};

/** Safety cap per category: programming had 4 pages in October 2026. */
const MAX_PAGES = 20;
const PAGE_DELAY_MS = 1_000;

/** Seniority keys in the classifier's words ("Semi Senior" is mid-level). */
const SENIORITY_HINTS: Record<string, string> = {
  no_experience: "entry-level",
  junior: "junior",
  semi_senior: "mid-level",
  senior: "senior",
  expert: "expert",
};

const WORKPLACES: Record<string, Workplace> = {
  fully_remote: "remote",
  remote_local: "remote",
  hybrid: "hybrid",
  no_remote: "onsite",
};

export function getOnBrdPageUrl(category: string, page: number): string {
  const expand = EXPAND.map((e) => `&expand[]=${e}`).join("");
  return `${API}/categories/${encodeURIComponent(category)}/jobs?per_page=${PER_PAGE}&page=${page}${expand}`;
}

function names<A extends { name: string }>(list: RefList<A> | undefined): string[] {
  return (list?.data ?? []).map((d) => d.attributes?.name ?? "").filter(Boolean);
}

/**
 * Where the role can be done from, as location strings the location
 * parser turns into allowed countries.
 */
function locationsOf(a: GetOnBrdJob["attributes"]): string[] {
  // `countries` holds "Remote" for both remote kinds; the real places are elsewhere.
  const countries = (a.countries ?? []).filter((c) => c !== "Remote");
  if (a.remote_modality === "fully_remote") return ["Worldwide"];
  if (a.remote_modality === "remote_local") {
    const places = [...names(a.location_tenants), ...names(a.location_regions)];
    return places.length > 0 ? places : countries;
  }
  const cities = (a.location_cities?.data ?? [])
    .map((c) => [c.attributes?.name, c.attributes?.country].filter(Boolean).join(", "))
    .filter(Boolean);
  // A city list can miss a country the role is also offered in.
  const uncovered = countries.filter((c) => !cities.some((city) => city.endsWith(`, ${c}`)));
  return [...cities, ...uncovered];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The posting's sections, in the order its page shows them. */
function descriptionHtml(a: GetOnBrdJob["attributes"]): string {
  const sections: [string | null | undefined, string | null | undefined][] = [
    [null, a.projects],
    [a.functions_headline, a.functions],
    [a.description_headline, a.description],
    [a.desirable_headline, a.desirable],
    [a.benefits_headline, a.benefits],
  ];
  return sections
    .filter(([, body]) => body && body.trim() !== "")
    .map(([heading, body]) => `${heading ? `<h3>${escapeHtml(heading)}</h3>` : ""}${body}`)
    .join("\n");
}

export function toRawJob(j: GetOnBrdJob, category: string): RawJob {
  const a = j.attributes;
  const company = a.company?.data?.attributes;
  const seniorityKey = a.seniority?.data?.attributes?.locale_key ?? "";
  const modality = a.modality?.data?.attributes;
  const tags = names(a.tags);
  const hint = GETONBRD_CATEGORIES[category];
  return {
    externalId: j.id,
    title: a.title,
    company: company?.name ?? "",
    companyLogo: company?.logo ?? null,
    url: j.links?.public_url ?? `https://www.getonbrd.com/jobs/${encodeURIComponent(j.id)}`,
    locations: locationsOf(a),
    workplace: WORKPLACES[a.remote_modality ?? ""] ?? null,
    descriptionHtml: descriptionHtml(a),
    tags,
    categoryHints: hint ? [hint] : [],
    seniorityHints: SENIORITY_HINTS[seniorityKey] ? [SENIORITY_HINTS[seniorityKey] as string] : [],
    employmentTypeHints: modality ? [modality.locale_key ?? modality.name] : [],
    salary: a.min_salary || a.max_salary ? { min: a.min_salary || null, max: a.max_salary || null, currency: "USD", period: "month" } : null,
    postedAt: a.published_at ? new Date(a.published_at * 1000).toISOString() : null,
  };
}

export interface GetOnBrdOptions {
  fetchPage?: (url: string) => Promise<GetOnBrdResponse>;
  categories?: readonly string[];
  maxPages?: number;
  pageDelayMs?: number;
}

export function createGetOnBrdSource({
  fetchPage = (url) => getJson<GetOnBrdResponse>(url),
  categories = Object.keys(GETONBRD_CATEGORIES),
  maxPages = MAX_PAGES,
  pageDelayMs = PAGE_DELAY_MS,
}: GetOnBrdOptions = {}): SourceAdapter {
  return {
    id: "getonbrd",
    name: "Get on Board",
    kind: "aggregator",
    homepage: "https://www.getonbrd.com",
    minIntervalMinutes: 60,
    async fetchJobs(): Promise<FetchOutcome> {
      // One feed for all categories, so a role moved between categories is
      // never closed by the category it left.
      const jobs = new Map<string, RawJob>();
      const errors: { feed: string; error: string }[] = [];
      let requests = 0;
      for (const category of categories) {
        try {
          for (let page = 1; ; page++) {
            if (page > maxPages) {
              errors.push({ feed: "all", error: `${category}: stopped at the ${maxPages}-page cap before the end of the feed` });
              break;
            }
            if (requests++ > 0 && pageDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
            const data = await fetchPage(getOnBrdPageUrl(category, page));
            // A role listed twice (in two categories, or shifted across a page
            // boundary while paging) is kept once.
            for (const j of data.data) if (!jobs.has(j.id)) jobs.set(j.id, toRawJob(j, category));
            if (data.data.length === 0 || page >= (data.meta?.total_pages ?? 0)) break;
          }
        } catch (err) {
          errors.push({ feed: "all", error: `${category}: stopped early: ${errorMessage(err)}` });
        }
      }
      if (jobs.size === 0 && errors.length > 0) return { results: [], errors };
      // Complete only when every category was read to its last page; then
      // roles missing from it are closed.
      return { results: [{ feed: "all", complete: errors.length === 0, jobs: [...jobs.values()] }], errors };
    },
  };
}

export const getOnBrdSource = createGetOnBrdSource();
