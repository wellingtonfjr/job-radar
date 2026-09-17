import type { JobSourceAdapter } from "./types.js";
import type { NewJob } from "../types/job.js";
import { stripHtml } from "./html.js";
import { parseAllowedCountries } from "../lib/locationRestriction.js";

/**
 * Greenhouse's public Job Board API is per-company:
 *   https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
 * There is no single "all jobs" endpoint across every Greenhouse customer,
 * so we hardcode a small starting list of companies known to publish a
 * public Greenhouse board.
 *
 * To add more companies: visit https://boards.greenhouse.io/{board_token}
 * (the token is the last path segment of a company's public careers URL,
 * or can be found in the network request their careers page makes to
 * boards-api.greenhouse.io) and append the token below.
 */
const BOARD_TOKENS = ["stripe", "airbnb", "coinbase", "cloudflare"];

interface GreenhouseLocation {
  name?: string | null;
}

interface GreenhouseMetadata {
  name?: string | null;
  value?: unknown;
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: GreenhouseLocation | null;
  content?: string | null;
  updated_at?: string | null;
  first_published?: string | null;
  company_name?: string | null;
  metadata?: GreenhouseMetadata[] | null;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

async function fetchBoard(boardToken: string): Promise<NewJob[]> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`);
  if (!res.ok) {
    throw new Error(`Greenhouse board "${boardToken}" responded ${res.status}`);
  }
  const data = (await res.json()) as GreenhouseResponse;
  return data.jobs.map((job): NewJob => {
    const locationName = job.location?.name ?? null;
    const tags = (job.metadata ?? [])
      .filter((m): m is GreenhouseMetadata & { name: string } => Boolean(m.name) && m.value != null && m.value !== "")
      .map((m) => `${m.name}:${String(m.value)}`);
    return {
      source: "greenhouse",
      externalId: String(job.id),
      title: job.title,
      company: job.company_name ?? boardToken,
      location: locationName,
      remote: /remote/i.test(locationName ?? ""),
      allowedCountries: parseAllowedCountries(locationName),
      url: job.absolute_url,
      description: stripHtml(job.content),
      tags,
      postedAt: job.first_published ?? job.updated_at ?? null,
    };
  });
}

export const greenhouseAdapter: JobSourceAdapter = {
  source: "greenhouse",
  async fetchJobs(): Promise<NewJob[]> {
    const settled = await Promise.allSettled(BOARD_TOKENS.map(fetchBoard));
    const jobs: NewJob[] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") {
        jobs.push(...result.value);
      } else {
        console.error(`[greenhouse] failed to fetch board "${BOARD_TOKENS[i]}":`, result.reason);
      }
    });
    return jobs;
  },
};
