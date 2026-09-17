export interface Job {
  id: string;
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
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
}

export const KNOWN_SOURCES = [
  'greenhouse',
  'lever',
  'remoteok',
  'remotive',
  'arbeitnow',
] as const;
