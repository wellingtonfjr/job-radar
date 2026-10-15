import type { RawJob } from "../domain/job.js";
import { normalizePeriod } from "../normalize/salary.js";
import { errorMessage, getJson } from "./http.js";
import type { FetchOutcome, SourceAdapter } from "./types.js";

/**
 * https://himalayas.app/api — public remote-jobs feed, newest first, 20 per
 * page with cursor pagination. The full feed is >100k jobs, so each run only
 * reads the newest pages; with an hourly cadence that keeps up with new
 * postings, but the fetch is never `complete` (absence ≠ closed). Himalayas
 * provides an `expiryDate`, which is what retires its jobs instead.
 */
interface HimalayasJob {
  guid: string;
  title: string;
  companyName: string;
  companyLogo?: string | null;
  employmentType?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  currency?: string | null;
  seniority?: string[] | null;
  locationRestrictions?: string[] | null;
  categories?: string[] | null;
  parentCategories?: string[] | null;
  description?: string | null;
  pubDate?: number | null;
  expiryDate?: number | null;
  applicationLink: string;
}

interface HimalayasResponse {
  jobs: HimalayasJob[];
  nextCursor?: string | null;
}

const MAX_PAGES = 25;

function toRawJob(j: HimalayasJob): RawJob {
  const restrictions = j.locationRestrictions ?? [];
  return {
    externalId: j.guid,
    title: j.title,
    company: j.companyName,
    companyLogo: j.companyLogo,
    url: j.applicationLink,
    locations: restrictions.length > 0 ? restrictions : ["Worldwide"],
    workplace: "remote",
    descriptionHtml: j.description,
    tags: (j.categories ?? []).map((c) => c.replace(/-/g, " ")).slice(0, 6),
    categoryHints: j.parentCategories ?? [],
    seniorityHints: j.seniority ?? [],
    employmentTypeHints: j.employmentType ? [j.employmentType] : [],
    salary:
      j.minSalary || j.maxSalary
        ? {
            min: j.minSalary ?? null,
            max: j.maxSalary ?? null,
            currency: j.currency ?? null,
            period: normalizePeriod(j.salaryPeriod) ?? "year",
          }
        : null,
    postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
    expiresAt: j.expiryDate ? new Date(j.expiryDate * 1000).toISOString() : null,
  };
}

export const himalayasSource: SourceAdapter = {
  id: "himalayas",
  name: "Himalayas",
  kind: "aggregator",
  homepage: "https://himalayas.app",
  minIntervalMinutes: 60,
  async fetchJobs(): Promise<FetchOutcome> {
    const jobs: RawJob[] = [];
    let cursor: string | null = null;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const data: HimalayasResponse = await getJson<HimalayasResponse>(url);
        jobs.push(...data.jobs.map(toRawJob));
        cursor = data.nextCursor ?? null;
        if (!cursor || data.jobs.length === 0) break;
      }
    } catch (err) {
      // Keep the pages already read: they are valid, just not the whole feed.
      if (jobs.length === 0) return { results: [], errors: [{ feed: "all", error: errorMessage(err) }] };
    }
    return { results: [{ feed: "all", complete: false, jobs }], errors: [] };
  },
};
