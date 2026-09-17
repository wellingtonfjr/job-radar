export interface Job {
  id: string;
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  /**
   * ISO 3166-1 alpha-2 codes this job's location text explicitly restricts
   * candidates to (e.g. a "Remote - US only" posting -> ["US"]), or `null`
   * when no restriction was detected (open to anyone, or the source gave
   * no usable signal). Best-effort, parsed from free-text location fields.
   */
  allowedCountries: string[] | null;
  url: string;
  description: string | null;
  tags: string[];
  postedAt: string | null;
  firstSeenAt: string;
}

export type NewJob = Omit<Job, "id" | "firstSeenAt">;

export interface JobFilters {
  keyword?: string;
  location?: string;
  remoteOnly?: boolean;
  source?: string;
  postedAfter?: string;
  /**
   * ISO 3166-1 alpha-2 codes the caller is based in. A job matches if it's
   * remote AND (it has no allowedCountries restriction OR that restriction
   * overlaps any of these codes). Union semantics across multiple codes.
   */
  baseCountries?: string[];
}
