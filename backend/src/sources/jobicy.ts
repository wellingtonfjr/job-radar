import type { RawJob } from "../domain/job.js";
import { normalizePeriod } from "../normalize/salary.js";
import { errorMessage, getJson } from "./http.js";
import type { FetchOutcome, SourceAdapter } from "./types.js";

/**
 * https://jobi.cy/apidocs — public remote-jobs feed (100 per page, cursor
 * pagination). Jobicy asks to be credited and that apply buttons go to the
 * job URL it provides, which is what `url` holds.
 */
interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  companyLogo?: string | null;
  jobIndustry?: string[] | null;
  jobType?: string[] | null;
  jobGeo?: string | null;
  jobLevel?: string | null;
  jobDescription?: string | null;
  pubDate?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
}

interface JobicyResponse {
  jobs: JobicyJob[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

const MAX_PAGES = 5;

function toRawJob(j: JobicyJob): RawJob {
  const geo = j.jobGeo?.trim();
  return {
    externalId: String(j.id),
    title: j.jobTitle,
    company: j.companyName,
    companyLogo: j.companyLogo,
    url: j.url,
    locations: geo ? geo.split(/\s*,\s*/) : ["Anywhere"],
    workplace: "remote",
    descriptionHtml: j.jobDescription,
    tags: j.jobIndustry ?? [],
    categoryHints: j.jobIndustry ?? [],
    seniorityHints: j.jobLevel && j.jobLevel !== "Any" ? [j.jobLevel] : [],
    employmentTypeHints: j.jobType ?? [],
    salary:
      j.salaryMin || j.salaryMax
        ? {
            min: j.salaryMin ?? null,
            max: j.salaryMax ?? null,
            currency: j.salaryCurrency ?? null,
            period: normalizePeriod(j.salaryPeriod) ?? "year",
          }
        : null,
    postedAt: j.pubDate ?? null,
  };
}

export const jobicySource: SourceAdapter = {
  id: "jobicy",
  name: "Jobicy",
  kind: "aggregator",
  homepage: "https://jobicy.com",
  minIntervalMinutes: 120,
  async fetchJobs(): Promise<FetchOutcome> {
    const jobs: RawJob[] = [];
    let cursor: string | null = null;
    let complete = false;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `https://jobicy.com/api/v2/remote-jobs?count=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const data: JobicyResponse = await getJson<JobicyResponse>(url);
        jobs.push(...data.jobs.map(toRawJob));
        cursor = data.nextCursor ?? null;
        if (!data.hasMore || !cursor) {
          complete = true;
          break;
        }
      }
    } catch (err) {
      if (jobs.length === 0) return { results: [], errors: [{ feed: "all", error: errorMessage(err) }] };
    }
    return { results: [{ feed: "all", complete, jobs }], errors: [] };
  },
};
