import type { RawJob, Workplace } from "../domain/job.js";
import { normalizePeriod } from "../normalize/salary.js";
import { fetchBoards, withDiscovered } from "./boards.js";
import { RECRUITEE_BOARDS, type CompanyBoard } from "./companies.js";
import { getJson } from "./http.js";
import type { SourceAdapter } from "./types.js";

/**
 * Recruitee's public offers API, per company subdomain:
 *   GET https://{company}.recruitee.com/api/offers/
 * Every published offer with its description and work-mode flags.
 */
interface RecruiteeLocation {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

interface RecruiteeOffer {
  id: number;
  title: string;
  careers_url: string;
  status?: string | null;
  description?: string | null;
  requirements?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  on_site?: boolean | null;
  department?: string | null;
  category_code?: string | null;
  employment_type_code?: string | null;
  locations?: RecruiteeLocation[] | null;
  location?: string | null;
  salary?: { min?: string | number | null; max?: string | number | null; currency?: string | null; period?: string | null } | null;
  published_at?: string | null;
  created_at?: string | null;
}

function workplace(offer: RecruiteeOffer): Workplace | null {
  if (offer.remote) return "remote";
  if (offer.hybrid) return "hybrid";
  if (offer.on_site) return "onsite";
  return null;
}

function amount(value: string | number | null | undefined): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** "2026-11-06 16:23:53 UTC" → ISO 8601. */
export function recruiteeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.replace(" ", "T").replace(/\s*UTC$/, "Z"));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchBoard(board: CompanyBoard): Promise<RawJob[]> {
  const data = await getJson<{ offers: RecruiteeOffer[] }>(`https://${board.token}.recruitee.com/api/offers/`);
  return data.offers
    .filter((offer) => (offer.status ?? "published") === "published")
    .map((offer): RawJob => {
      const hints = [offer.department, offer.category_code].filter((t): t is string => Boolean(t));
      const min = amount(offer.salary?.min);
      const max = amount(offer.salary?.max);
      const places = (offer.locations ?? [])
        .map((l) => [l.city, l.state, l.country].filter(Boolean).join(", "))
        .filter(Boolean);
      return {
        externalId: String(offer.id),
        title: offer.title,
        company: board.name,
        url: offer.careers_url,
        locations: places.length > 0 ? places : offer.location ? [offer.location] : [],
        workplace: workplace(offer),
        descriptionHtml: `${offer.description ?? ""}${offer.requirements ?? ""}`,
        tags: hints,
        categoryHints: hints,
        employmentTypeHints: offer.employment_type_code ? [offer.employment_type_code.replace(/_/g, " ")] : [],
        salary:
          min != null || max != null
            ? { min, max, currency: offer.salary?.currency ?? null, period: normalizePeriod(offer.salary?.period) ?? "year" }
            : null,
        postedAt: recruiteeDate(offer.published_at ?? offer.created_at),
      };
    });
}

export const recruiteeSource: SourceAdapter = {
  id: "recruitee",
  name: "Recruitee",
  kind: "ats",
  homepage: "https://recruitee.com",
  minIntervalMinutes: 60,
  feeds: RECRUITEE_BOARDS.map((b) => b.token),
  fetchJobs: (context) => fetchBoards(withDiscovered(RECRUITEE_BOARDS, context), fetchBoard),
};
