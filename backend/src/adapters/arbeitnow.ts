import type { JobSourceAdapter } from "./types.js";
import type { NewJob } from "../types/job.js";
import { stripHtml } from "./html.js";
import { parseAllowedCountries } from "../lib/locationRestriction.js";

/**
 * https://www.arbeitnow.com/api/job-board-api — public, no API key.
 * Paginated via `links.next`; we follow it until exhausted (capped for
 * safety in case the upstream API ever loops).
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
  links: { next: string | null };
}

const MAX_PAGES = 10;

async function fetchPage(url: string): Promise<ArbeitnowResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Arbeitnow responded ${res.status}`);
  }
  return (await res.json()) as ArbeitnowResponse;
}

export const arbeitnowAdapter: JobSourceAdapter = {
  source: "arbeitnow",
  async fetchJobs(): Promise<NewJob[]> {
    const jobs: NewJob[] = [];
    let url: string | null = "https://www.arbeitnow.com/api/job-board-api";
    let pages = 0;
    try {
      while (url && pages < MAX_PAGES) {
        const page: ArbeitnowResponse = await fetchPage(url);
        for (const j of page.data) {
          jobs.push({
            source: "arbeitnow",
            externalId: j.slug,
            title: j.title,
            company: j.company_name,
            location: j.location && j.location.trim() !== "" ? j.location : null,
            remote: Boolean(j.remote),
            allowedCountries: parseAllowedCountries(j.location),
            url: j.url,
            description: stripHtml(j.description),
            tags: [...(j.tags ?? []), ...(j.job_types ?? [])],
            postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
          });
        }
        url = page.links?.next ?? null;
        pages += 1;
      }
      return jobs;
    } catch (err) {
      console.error("[arbeitnow] failed to fetch jobs:", err);
      return [];
    }
  },
};
