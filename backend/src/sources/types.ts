import type { RawJob } from "../domain/job.js";

/**
 * A feed is the unit a source is fetched in: one company board for ATS
 * sources (Greenhouse, Lever, Ashby), or the whole listing for an aggregator.
 *
 * `complete` says the fetch returned *every* open job in that feed. Only then
 * can the pipeline safely close jobs that disappeared from it. Paginated
 * aggregators that are only read up to a page cap return `complete: false`.
 */
export interface FeedResult {
  feed: string;
  complete: boolean;
  jobs: RawJob[];
}

export interface FeedError {
  feed: string;
  error: string;
}

export interface FetchOutcome {
  results: FeedResult[];
  errors: FeedError[];
}

export type SourceKind = "ats" | "aggregator";

export interface SourceAdapter {
  id: string;
  name: string;
  /**
   * `ats`: postings come straight from the employer's applicant-tracking
   * system, so they are authoritative and preferred when de-duplicating.
   */
  kind: SourceKind;
  homepage: string;
  /** Minimum minutes between fetches, respecting each provider's terms. */
  minIntervalMinutes: number;
  /**
   * For per-company boards: every feed (board token) the source covers.
   * Jobs from a feed no longer listed — a company removed from curation —
   * are closed instead of lingering until they go stale.
   */
  feeds?: readonly string[];
  fetchJobs(): Promise<FetchOutcome>;
}
