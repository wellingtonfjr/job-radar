import type { Db } from "../db/index.js";
import { companyKey } from "../normalize/index.js";
import { errorMessage, mapLimit } from "../sources/http.js";
import { discoverBoard, loadBoard, matchPosting, type Board } from "./atsDiscovery.js";
import { remotiveApplyLink } from "./listingPages.js";
import type { ResolverNet } from "./net.js";

/**
 * Job boards (Remotive, Himalayas, Jobicy, Arbeitnow) link to their own
 * listing page. This finds the employer's own posting instead, trying, in
 * order of reliability:
 *
 *   1. ats-match      the same opening on an ATS board we already ingest
 *   2. description    an ATS job link written in the job description
 *   3. listing-page   Remotive's public "Apply for this position" link
 *   4. ats-discovery  the company's public ATS board (Greenhouse, Lever,
 *                     Ashby, Workable, Recruitee) with a same-title posting
 *
 * Every link is verified to still load before it's used. Jobs where nothing
 * verifiable is found keep the board's listing, and are retried later.
 */

export type ApplyMethod = "ats-match" | "description" | "listing-page" | "ats-discovery";

export interface ResolveOptions {
  now: Date;
  /** Jobs examined per run. */
  maxJobs?: number;
  /** Companies whose ATS board may be searched for per run (network-heavy). */
  discoveryBudget?: number;
  /** Re-check resolved or unresolved jobs after this many days. */
  recheckAfterDays?: number;
  /** Re-search a company with no known board after this many days. */
  boardRecheckDays?: number;
}

export interface ResolveSummary {
  examined: number;
  resolved: Record<ApplyMethod, number>;
  unresolved: number;
  deferred: number;
  errors: string[];
}

interface CandidateRow {
  id: string;
  source: string;
  title: string;
  company: string;
  url: string;
  fingerprint: string;
  description_links: string;
}

interface CachedBoard {
  provider: string | null;
  token: string | null;
  checked_at: string;
}

const CONCURRENCY = 4;

export async function resolveApplyLinks(db: Db, net: ResolverNet, options: ResolveOptions): Promise<ResolveSummary> {
  const { now, maxJobs = 3000, discoveryBudget = 200, recheckAfterDays = 7, boardRecheckDays = 14 } = options;
  const nowIso = now.toISOString();
  const recheckBefore = new Date(now.getTime() - recheckAfterDays * 86_400_000).toISOString();
  const boardRecheckBefore = new Date(now.getTime() - boardRecheckDays * 86_400_000).toISOString();

  const candidates = db
    .prepare(
      `SELECT id, source, title, company, url, fingerprint, description_links FROM jobs
       WHERE closed_at IS NULL AND canonical = 1 AND source_rank > 0
         AND (apply_checked_at IS NULL OR apply_checked_at < @recheckBefore)
       ORDER BY apply_checked_at IS NOT NULL, COALESCE(posted_at, first_seen_at) DESC
       LIMIT @maxJobs`,
    )
    .all({ recheckBefore, maxJobs }) as CandidateRow[];

  const atsCopy = db.prepare(
    "SELECT url FROM jobs WHERE fingerprint = ? AND source_rank = 0 AND closed_at IS NULL ORDER BY COALESCE(posted_at, first_seen_at) DESC LIMIT 1",
  );
  const getCachedBoard = db.prepare("SELECT provider, token, checked_at FROM ats_boards WHERE company_key = ?");
  const putCachedBoard = db.prepare(
    `INSERT INTO ats_boards (company_key, provider, token, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(company_key) DO UPDATE SET provider = excluded.provider, token = excluded.token, checked_at = excluded.checked_at`,
  );
  const save = db.prepare("UPDATE jobs SET apply_url = ?, apply_method = ?, apply_checked_at = ? WHERE id = ?");

  const summary: ResolveSummary = {
    examined: 0,
    resolved: { "ats-match": 0, description: 0, "listing-page": 0, "ats-discovery": 0 },
    unresolved: 0,
    deferred: 0,
    errors: [],
  };

  // Shared across jobs in this run: one board fetch per company/token.
  const triedBoards = new Map<string, Board | null>();
  const boardsByCompany = new Map<string, Promise<Board | null>>();
  let discoveriesLeft = discoveryBudget;

  /** The company's board, from cache or by (budgeted) discovery; `undefined` = over budget. */
  function boardFor(company: string): Promise<Board | null> | undefined {
    const key = companyKey(company);
    const existing = boardsByCompany.get(key);
    if (existing) return existing;

    const cached = getCachedBoard.get(key) as CachedBoard | undefined;
    let pending: Promise<Board | null>;
    if (cached?.provider && cached.token) {
      pending = loadBoard(net, cached.provider, cached.token);
    } else if (cached && cached.checked_at >= boardRecheckBefore) {
      pending = Promise.resolve(null);
    } else {
      if (discoveriesLeft <= 0) return undefined;
      discoveriesLeft -= 1;
      pending = discoverBoard(net, company, triedBoards).then((board) => {
        putCachedBoard.run(key, board?.provider ?? null, board?.token ?? null, nowIso);
        return board;
      });
    }
    boardsByCompany.set(key, pending);
    return pending;
  }

  async function verified(url: string | null): Promise<string | null> {
    return url && (await net.reachable(url)) ? url : null;
  }

  async function resolve(job: CandidateRow): Promise<{ url: string; method: ApplyMethod } | null | "deferred"> {
    const match = atsCopy.get(job.fingerprint) as { url: string } | undefined;
    if (match) return { url: match.url, method: "ats-match" };

    const links = JSON.parse(job.description_links) as string[];
    for (const link of links.slice(0, 2)) {
      const url = await verified(link);
      if (url) return { url, method: "description" };
    }

    if (job.source === "remotive") {
      const url = await verified(await remotiveApplyLink(net, job.url));
      if (url) return { url, method: "listing-page" };
    }

    const board = boardFor(job.company);
    if (board === undefined) return "deferred";
    const found = await board;
    const url = found ? await verified(matchPosting(found, job.title)) : null;
    return url ? { url, method: "ats-discovery" } : null;
  }

  await mapLimit(candidates, CONCURRENCY, async (job) => {
    try {
      const result = await resolve(job);
      if (result === "deferred") {
        summary.deferred += 1;
        return;
      }
      summary.examined += 1;
      save.run(result?.url ?? null, result?.method ?? null, nowIso, job.id);
      if (result) summary.resolved[result.method] += 1;
      else summary.unresolved += 1;
    } catch (err) {
      // Transient failure: leave unchecked so the next run retries it.
      summary.errors.push(`${job.id}: ${errorMessage(err)}`);
    }
  });

  return summary;
}
