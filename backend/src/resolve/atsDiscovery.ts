import { companyKey } from "../normalize/index.js";
import type { ResolverNet } from "./net.js";
import { cleanUrl } from "./postingUrls.js";

/**
 * Finds a company's public ATS board by trying the board names it most
 * likely uses ("Lemon.io" → "lemonio", "lemon-io", "lemon") on each
 * provider's public job-board API.
 */
export interface BoardJob {
  title: string;
  url: string;
}

export interface Board {
  provider: string;
  token: string;
  /** Company name the board reports, when the provider exposes it. */
  companyName: string | null;
  jobs: BoardJob[];
}

interface Provider {
  id: string;
  load(net: ResolverNet, token: string): Promise<Board | null>;
}

const PROVIDERS: Provider[] = [
  {
    id: "greenhouse",
    async load(net, token) {
      const data = await net.json<{ jobs: { title: string; absolute_url: string; company_name?: string }[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
      );
      if (!data?.jobs?.length) return null;
      return {
        provider: "greenhouse",
        token,
        companyName: data.jobs[0]?.company_name ?? null,
        jobs: data.jobs.map((j) => ({ title: j.title, url: j.absolute_url })),
      };
    },
  },
  {
    id: "lever",
    async load(net, token) {
      const data = await net.json<{ text: string; hostedUrl: string }[]>(`https://api.lever.co/v0/postings/${token}?mode=json`);
      if (!Array.isArray(data) || data.length === 0) return null;
      return { provider: "lever", token, companyName: null, jobs: data.map((j) => ({ title: j.text, url: j.hostedUrl })) };
    },
  },
  {
    id: "ashby",
    async load(net, token) {
      const data = await net.json<{ jobs: { title: string; jobUrl: string; isListed?: boolean }[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${token}`,
      );
      const jobs = (data?.jobs ?? []).filter((j) => j.isListed !== false);
      if (jobs.length === 0) return null;
      return { provider: "ashby", token, companyName: null, jobs: jobs.map((j) => ({ title: j.title, url: j.jobUrl })) };
    },
  },
  {
    id: "workable",
    async load(net, token) {
      const data = await net.json<{ name?: string; jobs: { title: string; url: string }[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${token}`,
      );
      if (!data?.jobs?.length) return null;
      return { provider: "workable", token, companyName: data.name ?? null, jobs: data.jobs.map((j) => ({ title: j.title, url: j.url })) };
    },
  },
  {
    id: "recruitee",
    async load(net, token) {
      const data = await net.json<{ offers: { title: string; careers_url: string; company_name?: string }[] }>(
        `https://${token}.recruitee.com/api/offers/`,
      );
      if (!data?.offers?.length) return null;
      return {
        provider: "recruitee",
        token,
        companyName: data.offers[0]?.company_name ?? null,
        jobs: data.offers.map((j) => ({ title: j.title, url: j.careers_url })),
      };
    },
  },
];

const LEGAL_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|sarl|bv|nv|plc|corp|corporation|company|oy|ab|pty|srl|spa|sro|co)\b/g;

/** Likely board tokens for a company name, most specific first (max 3). */
export function boardTokenCandidates(company: string): string[] {
  const base = company
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .trim();
  const words = base.replace(/\./g, " ").split(/\s+/).filter(Boolean);
  const withoutTld = base.replace(/\.(io|com|ai|co|app|dev|net|org|so)\b/g, "").split(/[\s.]+/).filter(Boolean);
  const candidates = [words.join(""), words.join("-"), withoutTld.join(""), withoutTld.join("-")];
  return [...new Set(candidates)].filter((c) => c.length >= 3 && c.length <= 40).slice(0, 3);
}

const GENDER_MARKER = /\(\s*(?:[mwfdhx]\s*\/\s*[mwfdhx](?:\s*\/\s*[mwfdhx])?|all genders?|alle geschlechter|any gender)\s*\)|\*in\b/gi;
const WORK_MODE_NOTE = /\(\s*(?:fully\s+|100%\s*)?(?:remote|hybrid|on-?site)[^)]*\)|\s[-–—|,]\s*(?:fully\s+)?(?:remote|hybrid)\s*$/gi;

/**
 * Key for "is this the same posting?". Stricter than de-duplication: only
 * gender markers ("(m/w/d)", "(all genders)") and work-mode notes
 * ("(Remote)", "- Remote") are ignored; every other qualifier ("- French
 * Speaker", "(Intern)", "II") must match.
 */
export function titleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(GENDER_MARKER, " ")
    .replace(WORK_MODE_NOTE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, "");
}

/**
 * Loads the first board found for the company. A board whose reported
 * company name clearly differs is skipped (token collision).
 */
export async function discoverBoard(net: ResolverNet, company: string, tried: Map<string, Board | null>): Promise<Board | null> {
  const key = companyKey(company);
  for (const token of boardTokenCandidates(company)) {
    for (const provider of PROVIDERS) {
      const cacheKey = `${provider.id}:${token}`;
      let board = tried.get(cacheKey);
      if (board === undefined) {
        board = await provider.load(net, token).catch(() => null);
        tried.set(cacheKey, board);
      }
      if (!board) continue;
      if (board.companyName && companyKey(board.companyName) !== key) continue;
      return board;
    }
  }
  return null;
}

/** Loads a known board directly (cached discovery). */
export async function loadBoard(net: ResolverNet, providerId: string, token: string): Promise<Board | null> {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  return provider ? provider.load(net, token).catch(() => null) : null;
}

/**
 * The posting on `board` with the same title. Several postings with the
 * *identical* title (one per city) are the same role; titles that only
 * match after normalization but differ otherwise are ambiguous → no link.
 */
export function matchPosting(board: Board, title: string): string | null {
  const key = titleKey(title);
  const matches = board.jobs.filter((j) => titleKey(j.title) === key);
  const distinctTitles = new Set(matches.map((j) => j.title.trim().toLowerCase()));
  if (matches.length === 0 || distinctTitles.size > 1) return null;
  return cleanUrl((matches[0] as BoardJob).url);
}
