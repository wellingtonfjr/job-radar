import type { JobSourceAdapter } from "./types.js";
import type { NewJob } from "../types/job.js";
import { parseAllowedCountries } from "../lib/locationRestriction.js";

/**
 * Lever's public Postings API is per-company:
 *   https://api.lever.co/v0/postings/{company}?mode=json
 * There is no aggregate endpoint across every Lever customer, so we hardcode
 * a small starting list of companies known to have a public Lever postings
 * page (i.e. https://jobs.lever.co/{company} resolves).
 *
 * To add more companies: confirm https://jobs.lever.co/{company} exists,
 * then append the slug (and, optionally, a display name) below.
 */
const COMPANY_SLUGS: Record<string, string> = {
  palantir: "Palantir",
  lever: "Lever",
  wealthsimple: "Wealthsimple",
  gopuff: "Gopuff",
};

interface LeverCategories {
  location?: string | null;
  team?: string | null;
  department?: string | null;
  commitment?: string | null;
}

interface LeverPosting {
  id: string;
  text: string;
  categories?: LeverCategories | null;
  createdAt?: number | null;
  hostedUrl?: string | null;
  applyUrl?: string | null;
  descriptionPlain?: string | null;
  workplaceType?: string | null;
}

async function fetchCompany(slug: string, displayName: string): Promise<NewJob[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!res.ok) {
    throw new Error(`Lever company "${slug}" responded ${res.status}`);
  }
  const postings = (await res.json()) as LeverPosting[];
  return postings.map((p): NewJob => {
    const location = p.categories?.location ?? null;
    const remote = (p.workplaceType ?? "").toLowerCase() === "remote" || /remote/i.test(location ?? "");
    const tags = [p.categories?.team, p.categories?.department, p.categories?.commitment].filter(
      (t): t is string => Boolean(t)
    );
    return {
      source: "lever",
      externalId: p.id,
      title: p.text,
      company: displayName,
      location,
      remote,
      allowedCountries: parseAllowedCountries(location),
      url: p.hostedUrl ?? p.applyUrl ?? "",
      description: p.descriptionPlain ?? null,
      tags,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    };
  });
}

export const leverAdapter: JobSourceAdapter = {
  source: "lever",
  async fetchJobs(): Promise<NewJob[]> {
    const entries = Object.entries(COMPANY_SLUGS);
    const settled = await Promise.allSettled(entries.map(([slug, name]) => fetchCompany(slug, name)));
    const jobs: NewJob[] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") {
        jobs.push(...result.value);
      } else {
        console.error(`[lever] failed to fetch "${entries[i][0]}":`, result.reason);
      }
    });
    return jobs;
  },
};
