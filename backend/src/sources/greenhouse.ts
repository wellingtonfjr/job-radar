import type { RawJob } from "../domain/job.js";
import { splitLocations } from "../normalize/location.js";
import { fetchBoards } from "./boards.js";
import { GREENHOUSE_BOARDS, type CompanyBoard } from "./companies.js";
import { getJson } from "./http.js";
import type { SourceAdapter } from "./types.js";

/** https://developers.greenhouse.io/job-board.html — public, per company. */
interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string | null } | null;
  content?: string | null;
  updated_at?: string | null;
  first_published?: string | null;
  departments?: { name?: string | null }[] | null;
  offices?: { name?: string | null; location?: string | null }[] | null;
}

async function fetchBoard(board: CompanyBoard): Promise<RawJob[]> {
  const data = await getJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`,
  );
  return data.jobs.map((job): RawJob => {
    const departments = (job.departments ?? []).map((d) => d.name).filter((n): n is string => Boolean(n));
    return {
      externalId: String(job.id),
      title: job.title,
      company: board.name,
      url: job.absolute_url,
      locations: splitLocations(job.location?.name),
      // Greenhouse has no structured remote flag; inferred from location text.
      workplace: null,
      descriptionHtml: job.content,
      tags: departments,
      categoryHints: departments,
      postedAt: job.first_published ?? job.updated_at ?? null,
    };
  });
}

export const greenhouseSource: SourceAdapter = {
  id: "greenhouse",
  name: "Greenhouse",
  kind: "ats",
  homepage: "https://www.greenhouse.com",
  minIntervalMinutes: 60,
  feeds: GREENHOUSE_BOARDS.map((b) => b.token),
  fetchJobs: () => fetchBoards(GREENHOUSE_BOARDS, fetchBoard),
};
