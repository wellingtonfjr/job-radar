import type { RawJob } from "../domain/job.js";
import { fetchBoards, withDiscovered } from "./boards.js";
import { WORKABLE_BOARDS, type CompanyBoard } from "./companies.js";
import { getJson } from "./http.js";
import type { SourceAdapter } from "./types.js";

/**
 * Workable's public careers widget, per company account:
 *   GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true
 * Every published job with its description, in one response.
 */
interface WorkableLocation {
  country?: string | null;
  city?: string | null;
  region?: string | null;
  hidden?: boolean;
}

interface WorkableJob {
  shortcode: string;
  title: string;
  url: string;
  employment_type?: string | null;
  telecommuting?: boolean | null;
  department?: string | null;
  function?: string | null;
  description?: string | null;
  published_on?: string | null;
  created_at?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  locations?: WorkableLocation[] | null;
}

function locations(job: WorkableJob): string[] {
  const listed = (job.locations ?? [])
    .filter((l) => !l.hidden)
    .map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "))
    .filter(Boolean);
  if (listed.length > 0) return listed;
  const single = [job.city, job.state, job.country].filter(Boolean).join(", ");
  return single ? [single] : [];
}

async function fetchBoard(board: CompanyBoard): Promise<RawJob[]> {
  const data = await getJson<{ jobs: WorkableJob[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${board.token}?details=true`,
  );
  return data.jobs.map((job): RawJob => {
    const hints = [job.function, job.department].filter((t): t is string => Boolean(t));
    return {
      externalId: job.shortcode,
      title: job.title,
      company: board.name,
      url: job.url,
      locations: locations(job),
      // Workable only flags fully remote roles; hybrid is inferred from text.
      workplace: job.telecommuting ? "remote" : null,
      descriptionHtml: job.description,
      tags: hints,
      categoryHints: hints,
      employmentTypeHints: job.employment_type ? [job.employment_type] : [],
      postedAt: job.published_on ?? job.created_at ?? null,
    };
  });
}

export const workableSource: SourceAdapter = {
  id: "workable",
  name: "Workable",
  kind: "ats",
  homepage: "https://www.workable.com",
  minIntervalMinutes: 60,
  feeds: WORKABLE_BOARDS.map((b) => b.token),
  fetchJobs: (context) => fetchBoards(withDiscovered(WORKABLE_BOARDS, context), fetchBoard),
};
