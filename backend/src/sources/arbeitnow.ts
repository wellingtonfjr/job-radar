import type { RawJob } from "../domain/job.js";
import { splitLocations } from "../normalize/location.js";
import { errorMessage, getJson } from "./http.js";
import type { FetchOutcome, SourceAdapter } from "./types.js";

/**
 * https://www.arbeitnow.com/api/job-board-api — public, mostly Europe-based
 * jobs (many in Germany), 300 per page via `links.next`, refreshed hourly.
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
      let url: string | null = FIRST_PAGE;
      try {
        for (let page = 0; page < maxPages && url; page++) {
          if (page > 0 && pageDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
          const data: ArbeitnowResponse = await fetchPage(url);
          jobs.push(...data.data.map(toRawJob));
          url = data.links?.next ?? null;
        }
      } catch (err) {
        if (jobs.length === 0) return { results: [], errors: [{ feed: "all", error: errorMessage(err) }] };
        // Keep the pages already read, but missing roles can't be closed.
        return { results: [{ feed: "all", complete: false, jobs }], errors: [{ feed: "all", error: `stopped early: ${errorMessage(err)}` }] };
      }
      // Complete only when the feed itself said there is no next page, not
      // when the cap cut it short.
      const complete = url === null;
      const errors = complete ? [] : [{ feed: "all", error: `stopped at the ${maxPages}-page cap before the end of the feed` }];
      return { results: [{ feed: "all", complete, jobs }], errors };
    },
  };
}

export const arbeitnowSource = createArbeitnowSource();
