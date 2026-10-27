import type { RawJob } from "../domain/job.js";
import { splitLocations } from "../normalize/location.js";
import { errorMessage, getJson } from "./http.js";
import type { FetchOutcome, SourceAdapter } from "./types.js";

/**
 * https://www.arbeitnow.com/api/job-board-api — public, mostly Europe-based
 * jobs (many in Germany), 100 per page via `links.next`, refreshed hourly.
 */
interface ArbeitnowJob {
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

interface ArbeitnowResponse {
  data: ArbeitnowJob[];
  links?: { next?: string | null };
}

const MAX_PAGES = 10;

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

export const arbeitnowSource: SourceAdapter = {
  id: "arbeitnow",
  name: "Arbeitnow",
  kind: "aggregator",
  homepage: "https://www.arbeitnow.com",
  minIntervalMinutes: 60,
  async fetchJobs(): Promise<FetchOutcome> {
    const jobs: RawJob[] = [];
    let url: string | null = "https://www.arbeitnow.com/api/job-board-api";
    let complete = false;
    try {
      for (let page = 0; page < MAX_PAGES && url; page++) {
        const data: ArbeitnowResponse = await getJson<ArbeitnowResponse>(url);
        jobs.push(...data.data.map(toRawJob));
        url = data.links?.next ?? null;
      }
      complete = url === null;
    } catch (err) {
      if (jobs.length === 0) return { results: [], errors: [{ feed: "all", error: errorMessage(err) }] };
    }
    return { results: [{ feed: "all", complete, jobs }], errors: [] };
  },
};
