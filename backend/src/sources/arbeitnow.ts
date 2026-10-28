import type { CategoryId, RawJob } from "../domain/job.js";
import { classifyCategory, classifySeniority } from "../normalize/classify.js";
import { htmlToText } from "../normalize/html.js";
import { detectLanguage } from "../normalize/language.js";
import { inferWorkplace, splitLocations } from "../normalize/location.js";
import { errorMessage, getJson } from "./http.js";
import type { FetchOutcome, SourceAdapter } from "./types.js";

/**
 * https://www.arbeitnow.com/api/job-board-api — public, mostly Europe-based
 * jobs (many in Germany), 300 per page via `links.next`, refreshed hourly.
 *
 * Most of the feed is on-site, non-English or student work (see #6), so only
 * part of it is kept: see `arbeitnowSkipReason`.
 */
export interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  remote: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  description?: string;
  created_at?: number;
}

export interface ArbeitnowResponse {
  data: ArbeitnowJob[];
  links?: { next?: string | null };
}

const FIRST_PAGE = "https://www.arbeitnow.com/api/job-board-api";
/**
 * Safety cap only: the whole feed is read so that roles missing from it can
 * be closed. 21 pages (~4,600 jobs) in October 2026; the cap leaves room for
 * the feed to roughly triple.
 */
const MAX_PAGES = 60;
/** Pause between pages: rapid paging trips the site's bot protection. */
const PAGE_DELAY_MS = 3_000;

export interface ArbeitnowOptions {
  fetchPage?: (url: string) => Promise<ArbeitnowResponse>;
  maxPages?: number;
  pageDelayMs?: number;
}

/**
 * Student, internship and side jobs, and ads already filled ("Succesvol
 * ingevuld"), matched on the accent-stripped title and job types.
 */
const NOT_A_JOB =
  /\b(werkstudent(in)?|working student|studentische|student (college|school)|hilfstatigkeit \/ student|praktikum\w*|praktikant\w*|praktkant\w*|pflichtpraktikum|intern|internship|stagiaire|stagiair|(?:^|\| )stage|stage (?:de|en|d)|alternan(ce|t)|minijob|mini-job|aushilfe|nebentatigkeit|bijbaan|ausbildung|apprenticeship|etudiant|succesvol ingevuld|vacature vervuld|position filled)\b/;

/** Categories kept even when the role is on-site. */
const TECH_CATEGORIES: ReadonlySet<CategoryId> = new Set([
  "software-development",
  "devops",
  "data",
  "ai-ml",
  "qa",
  "security",
  "product",
  "design",
]);

function plain(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export type ArbeitnowSkipReason = "not-a-job" | "not-english" | "onsite-non-tech";

/**
 * Why a role is left out, or `null` to keep it. Kept: English roles that are
 * remote or hybrid, and English tech roles anywhere. A description too short
 * to call a language is given the benefit of the doubt.
 */
export function arbeitnowSkipReason(j: ArbeitnowJob): ArbeitnowSkipReason | null {
  // Job types are sometimes wrong ("internship" on an Associate Director
  // role), so they only count when the title doesn't name a level.
  const types = classifySeniority(j.title) === null ? (j.job_types ?? []) : [];
  if (NOT_A_JOB.test(plain([j.title, ...types].join(" | ")))) return "not-a-job";
  const language = detectLanguage(`${j.title}\n${j.description ? htmlToText(j.description) : ""}`);
  if (language !== null && language !== "en") return "not-english";
  const workplace = inferWorkplace(j.remote ? "remote" : null, splitLocations(j.location), j.title);
  if (workplace !== "onsite") return null;
  return TECH_CATEGORIES.has(classifyCategory(j.title, j.tags ?? [])) ? null : "onsite-non-tech";
}

function toRawJob(j: ArbeitnowJob): RawJob {
  return {
    externalId: j.slug,
    title: j.title,
    company: j.company_name,
    url: j.url,
    locations: splitLocations(j.location),
    // `remote: false` only means "not fully remote"; hybrid is inferred from text.
    workplace: j.remote ? "remote" : null,
    descriptionHtml: j.description,
    tags: j.tags ?? [],
    categoryHints: j.tags ?? [],
    seniorityHints: j.job_types ?? [],
    employmentTypeHints: j.job_types ?? [],
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
  };
}

export function createArbeitnowSource({
  fetchPage = (url) => getJson<ArbeitnowResponse>(url),
  maxPages = MAX_PAGES,
  pageDelayMs = PAGE_DELAY_MS,
}: ArbeitnowOptions = {}): SourceAdapter {
  return {
    id: "arbeitnow",
    name: "Arbeitnow",
    kind: "aggregator",
    homepage: "https://www.arbeitnow.com",
    minIntervalMinutes: 60,
    async fetchJobs(): Promise<FetchOutcome> {
      const jobs: RawJob[] = [];
      let skipped = 0;
      const keep = (page: ArbeitnowJob[]): RawJob[] =>
        page.filter((j) => (arbeitnowSkipReason(j) === null ? true : (skipped++, false))).map(toRawJob);
      let url: string | null = FIRST_PAGE;
      try {
        for (let page = 0; page < maxPages && url; page++) {
          if (page > 0 && pageDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
          const data: ArbeitnowResponse = await fetchPage(url);
          jobs.push(...keep(data.data));
          url = data.links?.next ?? null;
        }
      } catch (err) {
        if (jobs.length === 0) return { results: [], errors: [{ feed: "all", error: errorMessage(err) }] };
        // Keep the pages already read, but missing roles can't be closed.
        return { results: [{ feed: "all", complete: false, jobs, skipped }], errors: [{ feed: "all", error: `stopped early: ${errorMessage(err)}` }] };
      }
      // Complete only when the feed itself said there is no next page, not
      // when the cap cut it short.
      const complete = url === null;
      const errors = complete ? [] : [{ feed: "all", error: `stopped at the ${maxPages}-page cap before the end of the feed` }];
      // Filtered roles are simply absent, so a complete read closes any that
      // were stored before; `skipped` keeps the drop guard from mistaking
      // that for a broken feed.
      return { results: [{ feed: "all", complete, jobs, skipped }], errors };
    },
  };
}

export const arbeitnowSource = createArbeitnowSource();
