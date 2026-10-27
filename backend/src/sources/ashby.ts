import type { RawJob, Salary, Workplace } from "../domain/job.js";
import { normalizePeriod } from "../normalize/salary.js";
import { fetchBoards } from "./boards.js";
import { ASHBY_BOARDS, type CompanyBoard } from "./companies.js";
import { getJson } from "./http.js";
import type { SourceAdapter } from "./types.js";

/** https://developers.ashbyhq.com/docs/public-job-posting-api — public, per company. */
interface AshbyCompensationComponent {
  compensationType?: string;
  interval?: string;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

interface AshbyJob {
  id: string;
  title: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string | null;
  location?: string | null;
  secondaryLocations?: { location?: string | null }[] | null;
  publishedAt?: string | null;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  jobUrl: string;
  descriptionHtml?: string | null;
  compensation?: { summaryComponents?: AshbyCompensationComponent[] | null } | null;
}

const WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

function toSalary(job: AshbyJob): Salary | null {
  const component = job.compensation?.summaryComponents?.find((c) => c.compensationType === "Salary");
  if (!component || (component.minValue == null && component.maxValue == null)) return null;
  return {
    min: component.minValue ?? null,
    max: component.maxValue ?? null,
    currency: component.currencyCode ?? null,
    period: normalizePeriod(component.interval) ?? "year",
  };
}

async function fetchBoard(board: CompanyBoard): Promise<RawJob[]> {
  const data = await getJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${board.token}?includeCompensation=true`,
  );
  return data.jobs
    .filter((job) => job.isListed !== false)
    .map((job): RawJob => {
      const hints = [job.team, job.department].filter((t): t is string => Boolean(t));
      const workplace = WORKPLACE[(job.workplaceType ?? "").toLowerCase()] ?? (job.isRemote ? "remote" : null);
      return {
        externalId: job.id,
        title: job.title,
        company: board.name,
        url: job.jobUrl,
        locations: [job.location, ...(job.secondaryLocations ?? []).map((l) => l.location)].filter(
          (l): l is string => Boolean(l),
        ),
        workplace,
        descriptionHtml: job.descriptionHtml,
        tags: hints,
        categoryHints: hints,
        employmentTypeHints: job.employmentType ? [job.employmentType.replace(/([a-z])([A-Z])/g, "$1 $2")] : [],
        salary: toSalary(job),
        postedAt: job.publishedAt ?? null,
      };
    });
}

export const ashbySource: SourceAdapter = {
  id: "ashby",
  name: "Ashby",
  kind: "ats",
  homepage: "https://www.ashbyhq.com",
  minIntervalMinutes: 60,
  feeds: ASHBY_BOARDS.map((b) => b.token),
  fetchJobs: () => fetchBoards(ASHBY_BOARDS, fetchBoard),
};
