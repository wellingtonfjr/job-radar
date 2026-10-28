import type { RawJob, Workplace } from "../domain/job.js";
import { fetchBoards } from "./boards.js";
import { SMARTRECRUITERS_BOARDS, type SmartRecruitersBoard } from "./companies.js";
import { getJson, mapLimit } from "./http.js";
import type { FetchContext, FetchOutcome, SourceAdapter } from "./types.js";

/**
 * SmartRecruiters (employer ATS). Public, per company, no auth:
 *   GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings?limit=100&offset=N
 *       → { totalFound, content[] }, every open posting (no description)
 *   GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings/{postingId}
 *       → one posting with its job ad (description sections)
 * Public posting page: https://jobs.smartrecruiters.com/{companyId}/{postingId}
 *
 * The list has no description, so each posting needs one detail request.
 * Those are only made for postings we don't already have a description
 * for (new ones, mostly), and at most `DETAIL_BUDGET` per run; the rest
 * keep their stored description and fill in on later runs.
 */
const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;
/** 10,000 postings: far above any seeded board; stops a runaway loop. */
const MAX_PAGES = 100;
const DETAIL_BUDGET = 500;
const DETAIL_CONCURRENCY = 3;

interface Labeled {
  id?: string | null;
  label?: string | null;
}

export interface SmartRecruitersPosting {
  id: string;
  name: string;
  releasedDate?: string | null;
  location?: {
    city?: string | null;
    region?: string | null;
    country?: string | null;
    remote?: boolean | null;
    hybrid?: boolean | null;
    fullLocation?: string | null;
  } | null;
  department?: Labeled | null;
  function?: Labeled | null;
  typeOfEmployment?: Labeled | null;
  experienceLevel?: Labeled | null;
}

interface PostingsPage {
  totalFound: number;
  content: SmartRecruitersPosting[];
}

export interface SmartRecruitersDetail {
  jobAd?: { sections?: Record<string, { title?: string | null; text?: string | null } | undefined> | null } | null;
}

/** Job ad sections, the role first (previews show the start), the company blurb last. */
const SECTIONS = ["jobDescription", "qualifications", "additionalInformation", "companyDescription"];

/**
 * Seniority hints by `experienceLevel.id`. "Mid-Senior Level" (LinkedIn's
 * catch-all) and "Not Applicable" say nothing, so the title decides.
 */
const EXPERIENCE_HINTS: Record<string, string> = {
  internship: "Internship",
  entry_level: "Entry Level",
  associate: "Associate",
  director: "Director",
  executive: "Executive",
};

export function smartRecruitersUrl(companyId: string, postingId: string): string {
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(companyId)}/${encodeURIComponent(postingId)}`;
}

function workplace(location: SmartRecruitersPosting["location"]): Workplace | null {
  if (location?.remote) return "remote";
  if (location?.hybrid) return "hybrid";
  // Both flags explicitly off is SmartRecruiters saying "on-site"; a title
  // or location that says hybrid still wins (see inferWorkplace).
  if (location?.remote === false && location.hybrid === false) return "onsite";
  return null;
}

function location(posting: SmartRecruitersPosting): string[] {
  const l = posting.location;
  if (!l) return [];
  const full = l.fullLocation?.trim();
  if (full) return [full];
  const parts = [l.city, l.region, l.country?.toUpperCase()].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? [parts.join(", ")] : [];
}

export function descriptionHtml(detail: SmartRecruitersDetail): string | null {
  const sections = detail.jobAd?.sections ?? {};
  const html = SECTIONS.map((key) => {
    const section = sections[key];
    if (!section?.text?.trim()) return "";
    return `${section.title ? `<h3>${section.title}</h3>` : ""}${section.text}`;
  }).join("");
  return html || null;
}

/** `description` is HTML from the detail endpoint, or text kept from an earlier run. */
export function toRawJob(
  board: SmartRecruitersBoard,
  posting: SmartRecruitersPosting,
  description: { html: string } | { text: string } | null,
): RawJob {
  const hints = [posting.department?.label, posting.function?.label].filter((h): h is string => Boolean(h?.trim()));
  const experience = EXPERIENCE_HINTS[posting.experienceLevel?.id ?? ""];
  const employment = posting.typeOfEmployment?.label;
  return {
    externalId: posting.id,
    title: posting.name,
    company: board.name,
    url: smartRecruitersUrl(board.token, posting.id),
    locations: location(posting),
    workplace: workplace(posting.location),
    descriptionHtml: description && "html" in description ? description.html : null,
    descriptionText: description && "text" in description ? description.text : null,
    tags: hints,
    categoryHints: hints,
    seniorityHints: experience ? [experience] : [],
    employmentTypeHints: employment ? [employment] : [],
    postedAt: posting.releasedDate ?? null,
  };
}

/**
 * Every posting on a board, page by page. Throws unless the pages add up to
 * the reported total, so a partial read is never mistaken for a complete feed.
 */
export async function fetchAllPostings(companyId: string): Promise<SmartRecruitersPosting[]> {
  const byId = new Map<string, SmartRecruitersPosting>();
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await getJson<PostingsPage>(
      `${API}/${encodeURIComponent(companyId)}/postings?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    );
    total = data.totalFound;
    for (const posting of data.content) byId.set(posting.id, posting);
    if (data.content.length === 0 || (page + 1) * PAGE_SIZE >= total) break;
  }
  if (byId.size < total) throw new Error(`${companyId}: read ${byId.size} of ${total} postings`);
  return [...byId.values()];
}

/** A per-run allowance of detail requests, shared by every board. */
export interface DetailBudget {
  left: number;
}

export async function fetchBoard(
  board: SmartRecruitersBoard,
  budget: DetailBudget,
  context?: FetchContext,
): Promise<{ jobs: RawJob[]; skipped: number }> {
  const postings = await fetchAllPostings(board.token);
  const wanted = board.functions
    ? postings.filter((p) => board.functions?.includes(p.function?.id ?? ""))
    : postings;

  const stored = wanted.map((p) => context?.storedDescription(p.id) ?? null);
  const toFetch = wanted.filter((_, i) => stored[i] === null && budget.left-- > 0);
  const details = await mapLimit(toFetch, DETAIL_CONCURRENCY, (p) =>
    getJson<SmartRecruitersDetail>(`${API}/${encodeURIComponent(board.token)}/postings/${encodeURIComponent(p.id)}`),
  );
  const fetched = new Map<string, string | null>();
  toFetch.forEach((p, i) => {
    const result = details[i];
    // A failed detail request leaves the job without a description rather
    // than dropping it — a missing job would otherwise be closed.
    fetched.set(p.id, result?.status === "fulfilled" ? descriptionHtml(result.value) : null);
  });

  const jobs = wanted.map((posting, i) => {
    const text = stored[i];
    const html = fetched.get(posting.id);
    return toRawJob(board, posting, text !== null && text !== undefined ? { text } : html ? { html } : null);
  });
  return { jobs, skipped: postings.length - wanted.length };
}

export const smartRecruitersSource: SourceAdapter = {
  id: "smartrecruiters",
  name: "SmartRecruiters",
  kind: "ats",
  homepage: "https://www.smartrecruiters.com",
  // Large boards take dozens of list pages, plus detail requests.
  minIntervalMinutes: 120,
  feeds: SMARTRECRUITERS_BOARDS.map((b) => b.token),
  async fetchJobs(context): Promise<FetchOutcome> {
    const budget: DetailBudget = { left: DETAIL_BUDGET };
    const skipped = new Map<string, number>();
    const outcome = await fetchBoards(SMARTRECRUITERS_BOARDS, async (board) => {
      const result = await fetchBoard(board, budget, context);
      skipped.set(board.token, result.skipped);
      return result.jobs;
    });
    for (const result of outcome.results) {
      const n = skipped.get(result.feed);
      if (n) result.skipped = n;
    }
    return outcome;
  },
};
