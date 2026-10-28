/**
 * Asks an applicant-tracking system (ATS) whether one posting is still open.
 *
 * Only answers we can trust are given: the ATS's own public API either has
 * the posting or says it doesn't. Everything else is `unknown`, never a
 * guess. Job-board pages are deliberately not used: Himalayas answers 403 to
 * scripts, and Jobicy, Arbeitnow and Remotive answer 200 even for closed
 * roles, so a page loading says nothing.
 */

export type Verdict = "open" | "closed" | "unknown";

export type AtsProvider = "greenhouse" | "lever" | "ashby" | "smartrecruiters";

/** One posting on one company's board. */
export interface PostingRef {
  provider: AtsProvider;
  board: string;
  id: string;
  /** Lever's EU instance (jobs.eu.lever.co → api.eu.lever.co). */
  eu?: boolean;
}

export const AUDIT_USER_AGENT = "job-radar-accuracy-audit (+https://radar-de-vagas.fly.dev)";

/**
 * Consecutive "closed" verdicts after which the liveness check closes a role
 * (see liveness.ts). One could be a blip; two, hours apart, aren't.
 */
export const CLOSED_VERDICTS_TO_CLOSE = 2;

/** Posting URLs whose board and id can be checked through the ATS API. */
const URL_PATTERNS: { provider: AtsProvider; pattern: RegExp }[] = [
  { provider: "greenhouse", pattern: /greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i },
  { provider: "lever", pattern: /jobs(\.eu)?\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i },
  { provider: "ashby", pattern: /jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i },
  // jobs.smartrecruiters.com/{companyId}/{postingId}-{optional-slug}
  { provider: "smartrecruiters", pattern: /(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)\/(\d+)(?=[-/?#]|$)/i },
];

/** The ATS posting a URL points to, or null when it isn't one we can check. */
export function parsePostingRef(url: string | null | undefined): PostingRef | null {
  if (!url) return null;
  for (const { provider, pattern } of URL_PATTERNS) {
    const match = pattern.exec(url);
    if (!match) continue;
    if (provider === "lever") {
      return { provider, board: decodeURIComponent(match[2] as string), id: (match[3] as string).toLowerCase(), ...(match[1] ? { eu: true } : {}) };
    }
    return { provider, board: decodeURIComponent(match[1] as string), id: provider === "ashby" ? (match[2] as string).toLowerCase() : (match[2] as string) };
  }
  return null;
}

/** The ref for a row ingested straight from an ATS: feed is the board token, external_id the posting id. */
export function refFromAtsRow(source: string, feed: string, externalId: string): PostingRef | null {
  if (source === "greenhouse" || source === "lever" || source === "ashby" || source === "smartrecruiters") {
    return { provider: source, board: feed, id: externalId };
  }
  return null;
}

/** A finished GET: status and the whole body. */
export interface AuditResponse {
  status: number;
  body: string;
}

/** The network calls the audit makes; swapped for fakes in tests. */
export interface AuditNet {
  /** GET with an identifying User-Agent; null on a network error or timeout. */
  get(url: string): Promise<AuditResponse | null>;
}

export interface AuditNetOptions {
  fetch?: typeof globalThis.fetch;
  /** Minimum time between two requests to the same host. */
  minGapMs?: number;
  timeoutMs?: number;
  userAgent?: string;
}

/**
 * The live network: an identifying User-Agent, a timeout, and requests to
 * the same host spaced at least `minGapMs` apart (on top of the audit's low
 * concurrency), so no provider sees a burst from us.
 */
export function createAuditNet({
  fetch = globalThis.fetch,
  minGapMs = 1_000,
  timeoutMs = 15_000,
  userAgent = AUDIT_USER_AGENT,
}: AuditNetOptions = {}): AuditNet {
  const nextSlot = new Map<string, number>();

  async function waitTurn(host: string): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + minGapMs);
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }

  return {
    async get(url) {
      await waitTurn(new URL(url).host);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": userAgent, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Read the whole body: an Ashby board can be several MB, and a
        // truncated list would make open roles look closed.
        return { status: res.status, body: await res.text() };
      } catch {
        return null;
      }
    },
  };
}

function byStatus(response: AuditResponse | null): Verdict {
  if (!response) return "unknown";
  if (response.status === 200) return "open";
  if (response.status === 404) return "closed";
  // 403, 429, 5xx…: the API didn't answer the question.
  return "unknown";
}

interface AshbyBoard {
  jobs?: { id?: string; isListed?: boolean }[];
}

/**
 * A verifier for one audit run. Greenhouse, Lever and SmartRecruiters have
 * a per-posting endpoint that answers 200 or 404. Ashby has none, so each board's list is
 * fetched once per run and every posting is looked up in it.
 */
export function createVerifier(net: AuditNet): (ref: PostingRef) => Promise<Verdict> {
  const ashbyBoards = new Map<string, Promise<Map<string, boolean> | null>>();

  function ashbyBoard(board: string): Promise<Map<string, boolean> | null> {
    let pending = ashbyBoards.get(board);
    if (!pending) {
      pending = net.get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`).then((response) => {
        if (response?.status !== 200) return null;
        try {
          const data = JSON.parse(response.body) as AshbyBoard;
          if (!Array.isArray(data.jobs)) return null;
          // id → whether it's publicly listed (unlisted ones aren't shown, so we close them).
          return new Map(data.jobs.filter((j) => j.id).map((j) => [(j.id as string).toLowerCase(), j.isListed !== false]));
        } catch {
          return null;
        }
      });
      ashbyBoards.set(board, pending);
    }
    return pending;
  }

  return async (ref) => {
    const board = encodeURIComponent(ref.board);
    switch (ref.provider) {
      case "greenhouse":
        return byStatus(await net.get(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${encodeURIComponent(ref.id)}`));
      case "lever":
        return byStatus(await net.get(`https://api${ref.eu ? ".eu" : ""}.lever.co/v0/postings/${board}/${encodeURIComponent(ref.id)}`));
      case "smartrecruiters":
        return byStatus(await net.get(`https://api.smartrecruiters.com/v1/companies/${board}/postings/${encodeURIComponent(ref.id)}`));
      case "ashby": {
        const listed = await ashbyBoard(ref.board);
        // A board we couldn't read says nothing about the posting.
        if (!listed) return "unknown";
        return listed.get(ref.id.toLowerCase()) ? "open" : "closed";
      }
    }
  };
}
