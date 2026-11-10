import type { RawJob } from "../domain/job.js";
import type { CompanyBoard } from "./companies.js";
import { errorMessage, HttpError, mapLimit } from "./http.js";
import type { FetchContext, FetchOutcome } from "./types.js";

const BOARD_CONCURRENCY = 4;

/**
 * Fetches every company board of one ATS. A board's response is the full
 * list of that company's open jobs, so each successful board is a
 * `complete` feed; a failed board is reported as an error and its jobs are
 * left untouched (never closed because of a transient failure).
 *
 * With `context.emit`, each board goes to the pipeline as soon as it arrives
 * and is dropped here, so memory holds a few boards, not all of them.
 */
export async function fetchBoards<B extends CompanyBoard>(
  boards: readonly B[],
  fetchBoard: (board: B) => Promise<RawJob[]>,
  context?: FetchContext,
): Promise<FetchOutcome> {
  const emit = context?.emit;
  const settled = await mapLimit(boards, BOARD_CONCURRENCY, async (board): Promise<RawJob[] | null> => {
    const jobs = await fetchBoard(board);
    if (!emit) return jobs;
    emit({ feed: board.token, complete: true, jobs });
    return null;
  });
  const outcome: FetchOutcome = { results: [], errors: [] };
  settled.forEach((result, i) => {
    const feed = (boards[i] as B).token;
    if (result.status === "fulfilled") {
      if (result.value) outcome.results.push({ feed, complete: true, jobs: result.value });
    } else {
      const gone = result.reason instanceof HttpError && (result.reason.status === 404 || result.reason.status === 410);
      outcome.errors.push({ feed, error: errorMessage(result.reason), ...(gone ? { gone } : {}) });
    }
  });
  return outcome;
}

/** The curated boards plus the ones discovery found for this run. */
export function withDiscovered(curated: readonly CompanyBoard[], context?: FetchContext): CompanyBoard[] {
  return [...curated, ...(context?.discoveredBoards ?? [])];
}
