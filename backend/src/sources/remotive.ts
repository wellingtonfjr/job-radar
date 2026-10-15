import type { RawJob } from "../domain/job.js";
import { errorMessage, getJson } from "./http.js";
import type { FetchOutcome, SourceAdapter } from "./types.js";

/**
 * https://remotive.com/api-documentation — the free public feed is small
 * (a delayed sample of Remotive's listings). Its terms ask for at most ~4
 * requests a day and a link back to the Remotive URL, so the interval is 6h
 * and `url` is the remotive.com posting.
 */
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  company_logo?: string | null;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

function toRawJob(j: RemotiveJob): RawJob {
  return {
    externalId: String(j.id),
    title: j.title,
    company: j.company_name,
    companyLogo: j.company_logo,
    url: j.url,
    locations: (j.candidate_required_location ?? "Worldwide").split(/\s*,\s*/).filter(Boolean),
    workplace: "remote",
    descriptionHtml: j.description,
    tags: j.tags ?? [],
    categoryHints: j.category ? [j.category] : [],
    employmentTypeHints: j.job_type ? [j.job_type] : [],
    salaryText: j.salary || null,
    // Remotive dates have no zone designator but are UTC.
    postedAt: j.publication_date ? `${j.publication_date.replace(/Z$/, "")}Z` : null,
  };
}

export const remotiveSource: SourceAdapter = {
  id: "remotive",
  name: "Remotive",
  kind: "aggregator",
  homepage: "https://remotive.com",
  minIntervalMinutes: 360,
  async fetchJobs(): Promise<FetchOutcome> {
    try {
      const data = await getJson<{ jobs: RemotiveJob[] }>("https://remotive.com/api/remote-jobs");
      // The endpoint returns its whole public feed in one response.
      return { results: [{ feed: "all", complete: true, jobs: data.jobs.map(toRawJob) }], errors: [] };
    } catch (err) {
      return { results: [], errors: [{ feed: "all", error: errorMessage(err) }] };
    }
  },
};
