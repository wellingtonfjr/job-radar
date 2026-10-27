import type { RawJob, Workplace } from "../domain/job.js";
import { splitLocations } from "../normalize/location.js";
import { fetchBoards } from "./boards.js";
import { INHIRE_BOARDS, type CompanyBoard } from "./companies.js";
import { getJson, mapLimit } from "./http.js";
import type { SourceAdapter } from "./types.js";

/**
 * InHire (Brazilian ATS). Public, per company ("tenant" = career-page
 * subdomain), selected with the `X-Tenant` header:
 *   GET https://api.inhire.app/job-posts/public/pages            → every published job (no description)
 *   GET https://api.inhire.app/job-posts/public/pages/{jobId}    → one job with description and dates
 * Public posting page: https://{tenant}.inhire.app/vagas/{jobId}/{slug}
 * (the page needs a slug segment to render the job; any slug works, so we
 * build one the way InHire does).
 *
 * Only remote and hybrid roles are ingested (the platform's focus); that
 * keeps detail requests to one per relevant job. The board list is still
 * complete for that subset, so roles that disappear get closed.
 */
const API = "https://api.inhire.app/job-posts/public/pages";
const DETAIL_CONCURRENCY = 3;

export interface InhireListItem {
  jobId: string;
  displayName: string;
  status?: string;
  workplaceType?: string | null;
  location?: string | null;
}

export interface InhireDetail extends InhireListItem {
  description?: string | null;
  contractType?: string[] | null;
  publishedAt?: string | null;
  lastPublishedAt?: string | null;
  createdAt?: string | null;
  salaryCurrency?: string | null;
}

const WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };
const COUNTRY_CODE_SUFFIX = /,\s*([A-Z]{2})$/;

let regionNames: Intl.DisplayNames | null = null;

/** "Joinville, SC, BR" → "Joinville, SC, Brazil" (the trailing part is an ISO country code). */
export function expandCountryCode(location: string): string {
  const code = location.trim().match(COUNTRY_CODE_SUFFIX)?.[1] ?? location.trim().match(/^([A-Z]{2})$/)?.[1];
  if (!code) return location.trim();
  regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
  const name = regionNames.of(code);
  if (!name || name === code) return location.trim();
  return location.trim().length === 2 ? name : location.trim().replace(COUNTRY_CODE_SUFFIX, `, ${name}`);
}

/** Internal requisition codes some companies prefix to titles ("3606: Consultor SAP MM"). */
export function cleanInhireTitle(title: string): string {
  return title.replace(/^\s*[A-Z0-9]{3,6}:\s*/, "").replace(/\s+/g, " ").trim();
}

/** "Programa de Estágio | Geração Desafio" → "programa-de-estagio-or-geracao-desafio". */
export function inhireSlug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\|/g, " or ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vaga"
  );
}

export function inhireJobUrl(token: string, jobId: string, title: string): string {
  return `https://${token}.inhire.app/vagas/${jobId}/${inhireSlug(title)}`;
}

export function toRawJob(board: CompanyBoard, item: InhireListItem, detail: InhireDetail | null): RawJob {
  const job = { ...item, ...detail };
  const location = job.location ? expandCountryCode(job.location) : "";
  // A remote role with no location but a BRL salary is a Brazil-only role.
  const locations = location ? splitLocations(location) : job.salaryCurrency === "BRL" ? ["Brazil"] : [];
  const title = cleanInhireTitle(job.displayName);
  return {
    externalId: job.jobId,
    title,
    company: board.name,
    url: inhireJobUrl(board.token, job.jobId, job.displayName),
    locations,
    workplace: WORKPLACE[(job.workplaceType ?? "").toLowerCase()] ?? null,
    descriptionHtml: job.description ?? null,
    employmentTypeHints: job.contractType ?? [],
    postedAt: job.lastPublishedAt ?? job.publishedAt ?? job.createdAt ?? null,
  };
}

async function fetchBoard(board: CompanyBoard): Promise<RawJob[]> {
  const headers = { "X-Tenant": board.token };
  const page = await getJson<{ jobsPage?: InhireListItem[] }>(API, { headers });
  const relevant = (page.jobsPage ?? []).filter(
    (j) => (j.status ?? "published") === "published" && /^(remote|hybrid)$/i.test(j.workplaceType ?? ""),
  );
  const details = await mapLimit(relevant, DETAIL_CONCURRENCY, (item) =>
    getJson<InhireDetail>(`${API}/${encodeURIComponent(item.jobId)}`, { headers }),
  );
  // A failed detail request falls back to the list data rather than
  // dropping the job — a missing job would otherwise be closed.
  return relevant.map((item, i) => {
    const result = details[i];
    return toRawJob(board, item, result?.status === "fulfilled" ? result.value : null);
  });
}

export const inhireSource: SourceAdapter = {
  id: "inhire",
  name: "InHire",
  kind: "ats",
  homepage: "https://www.inhire.com.br",
  // One detail request per remote/hybrid role: keep the cadence modest.
  minIntervalMinutes: 360,
  feeds: INHIRE_BOARDS.map((b) => b.token),
  fetchJobs: () => fetchBoards(INHIRE_BOARDS, fetchBoard),
};
