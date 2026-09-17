export interface Job {
  id: string;
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  /** ISO 3166-1 alpha-2 codes this job restricts candidates to, or null if unrestricted. */
  allowedCountries: string[] | null;
  url: string;
  description: string | null;
  tags: string[];
  postedAt: string | null;
  firstSeenAt: string;
}

export interface JobsResponse {
  jobs: Job[];
  total: number;
}

export interface JobFilters {
  keyword: string;
  location: string;
  remoteOnly: boolean;
  source: string;
  /** ISO 3166-1 alpha-2 codes the viewer is based in (union match). */
  baseCountries: string[];
}

export const KNOWN_SOURCES = ['greenhouse', 'lever', 'remotive', 'arbeitnow'] as const;
