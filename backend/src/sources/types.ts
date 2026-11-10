import type { RawJob } from "../domain/job.js";
import type { CompanyBoard } from "./companies.js";

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
  /**
   * Jobs the feed listed but the adapter deliberately left out (filtered as
   * off-topic). They count as "listed" for the pipeline's drop guard, so a
   * new filter closes its stored jobs instead of looking like a broken feed.
   */
  skipped?: number;
}

export interface FeedError {
  feed: string;
  error: string;
  /** The provider said the feed doesn't exist (404/410), not a transient failure. */
  gone?: boolean;
}

export interface FetchOutcome {
  results: FeedResult[];
  errors: FeedError[];
}

/** What the pipeline already knows, for adapters that fetch details sparingly. */
export interface FetchContext {
  /** The description stored for this source's posting, or null if none yet. */
  storedDescription(externalId: string): string | null;
  /**
   * Company boards on this ATS found by apply-link discovery, beyond the
   * curated list (see `discoveredBoards` in ingestion/pipeline.ts).
   */
  discoveredBoards?: readonly CompanyBoard[];
  /**
   * When set, board adapters hand each board's result here as soon as it
   * arrives instead of returning it in `results`, so a run never holds every
   * board (with full descriptions) in memory at once.
   */
  emit?(result: FeedResult): void;
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
  fetchJobs(context?: FetchContext): Promise<FetchOutcome>;
}
