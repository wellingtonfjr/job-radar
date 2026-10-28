import type { RawJob } from "../domain/job.js";
import type { CompanyBoard } from "./companies.js";
import { errorMessage, mapLimit } from "./http.js";
import type { FetchOutcome } from "./types.js";

const BOARD_CONCURRENCY = 4;

/**
 * Fetches every company board of one ATS. A board's response is the full
 * list of that company's open jobs, so each successful board is a
 * `complete` feed; a failed board is reported as an error and its jobs are
 * left untouched (never closed because of a transient failure).
 */
export async function fetchBoards<B extends CompanyBoard>(
  boards: readonly B[],
  fetchBoard: (board: B) => Promise<RawJob[]>,
): Promise<FetchOutcome> {
  const settled = await mapLimit(boards, BOARD_CONCURRENCY, fetchBoard);
  const outcome: FetchOutcome = { results: [], errors: [] };
  settled.forEach((result, i) => {
    const feed = (boards[i] as B).token;
    if (result.status === "fulfilled") {
      outcome.results.push({ feed, complete: true, jobs: result.value });
    } else {
      outcome.errors.push({ feed, error: errorMessage(result.reason) });
    }
  });
  return outcome;
}
