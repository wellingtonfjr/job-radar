import type { RawJob, Workplace } from "../domain/job.js";
import { normalizePeriod } from "../normalize/salary.js";
import { fetchBoards } from "./boards.js";
import { LEVER_BOARDS, type CompanyBoard } from "./companies.js";
import { getJson } from "./http.js";
import type { SourceAdapter } from "./types.js";

/** https://github.com/lever/postings-api — public, per company. */
interface LeverPosting {
  id: string;
  text: string;
  categories?: {
    location?: string | null;
    allLocations?: string[] | null;
    team?: string | null;
    department?: string | null;
    commitment?: string | null;
  } | null;
  createdAt?: number | null;
  hostedUrl?: string | null;
  applyUrl?: string | null;
  description?: string | null;
  lists?: { text?: string | null; content?: string | null }[] | null;
  additional?: string | null;
  workplaceType?: string | null;
  salaryRange?: { currency?: string; interval?: string; min?: number; max?: number } | null;
}

const WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };

function descriptionHtml(p: LeverPosting): string {
  const lists = (p.lists ?? []).map((l) => `<h3>${l.text ?? ""}</h3><ul>${l.content ?? ""}</ul>`).join("");
  return `${p.description ?? ""}${lists}${p.additional ?? ""}`;
}

async function fetchBoard(board: CompanyBoard): Promise<RawJob[]> {
  const postings = await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${board.token}?mode=json`);
  return postings.map((p): RawJob => {
    const c = p.categories ?? {};
    const hints = [c.team, c.department].filter((t): t is string => Boolean(t));
    const range = p.salaryRange;
    return {
      externalId: p.id,
      title: p.text,
      company: board.name,
      url: p.hostedUrl ?? p.applyUrl ?? `https://jobs.lever.co/${board.token}/${p.id}`,
      locations: c.allLocations?.length ? c.allLocations : c.location ? [c.location] : [],
      workplace: WORKPLACE[(p.workplaceType ?? "").toLowerCase()] ?? null,
      descriptionHtml: descriptionHtml(p),
      tags: hints,
      categoryHints: hints,
      employmentTypeHints: c.commitment ? [c.commitment] : [],
      salary: range
        ? {
            min: range.min ?? null,
            max: range.max ?? null,
            currency: range.currency ?? null,
            period: normalizePeriod(range.interval) ?? "year",
          }
        : null,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    };
  });
}

export const leverSource: SourceAdapter = {
  id: "lever",
  name: "Lever",
  kind: "ats",
  homepage: "https://www.lever.co",
  minIntervalMinutes: 60,
  feeds: LEVER_BOARDS.map((b) => b.token),
  fetchJobs: () => fetchBoards(LEVER_BOARDS, fetchBoard),
};
