import type { NormalizedJob, RawJob } from "../domain/job.js";
import { classifyCategory, classifyEmploymentType, classifySeniority } from "./classify.js";
import { cleanText, decodeEntities, htmlToText } from "./html.js";
import { inferWorkplace, parseAllowedCountries } from "./location.js";
import { extractSkills } from "./skills.js";
import { annualUsd, extractSalaryFromDescription, parseSalaryText, validateSalary } from "./salary.js";

// Matched against the already-normalized (lowercase, alphanumeric) name.
const COMPANY_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|gmbh|ag|sa|sas|sarl|bv|nv|plc|co|corp|corporation|company|oy|ab|as|aps|pty|srl|spa|sro)\b/g;

function normalizeKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Acme, Inc." and "ACME" → "acme". Groups a company's jobs across sources. */
export function companyKey(company: string): string {
  return normalizeKey(company.replace(/\./g, "")).replace(COMPANY_SUFFIXES, "").replace(/\s+/g, "");
}

/**
 * Identifies "the same opening" across sources: the same employer often
 * posts on its own ATS *and* appears on aggregators. Company legal suffixes
 * and anything in parentheses / after a separator ("Senior Engineer (Remote)",
 * "Backend Engineer - EMEA") are dropped so cosmetic differences still match.
 */
export function fingerprint(company: string, title: string): string {
  const c = companyKey(company);
  const t = normalizeKey(title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/\s[-–—|]\s/)[0] ?? title).replace(/\s+/g, "");
  return `${c}|${t}`;
}

function cleanLabel(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function normalizeJob(source: string, feed: string, raw: RawJob): NormalizedJob {
  const title = cleanLabel(raw.title);
  const company = cleanLabel(raw.company);
  const locations = Array.from(new Set(raw.locations.map(cleanLabel).filter(Boolean)));
  const workplace = inferWorkplace(raw.workplace, locations, title);
  const hints = (raw.categoryHints ?? []).map(cleanLabel);
  const tags = Array.from(new Set((raw.tags ?? []).map(cleanLabel).filter((t) => t.length > 0 && t.length <= 40))).slice(0, 15);

  const description = raw.descriptionHtml ? htmlToText(raw.descriptionHtml) : cleanText(raw.descriptionText);
  const salary = validateSalary(raw.salary) ?? parseSalaryText(raw.salaryText) ?? extractSalaryFromDescription(description);
  const postedAt = toIsoDate(raw.postedAt);
  // Some sources report publication dates in the future; clamp to now so
  // they don't pin themselves to the top of "newest first".
  const now = new Date().toISOString();

  return {
    id: `${source}:${raw.externalId}`,
    source,
    feed,
    externalId: raw.externalId,
    title,
    company,
    companyLogo: raw.companyLogo || null,
    url: raw.url,
    locations,
    workplace,
    allowedCountries: parseAllowedCountries(locations),
    category: classifyCategory(title, hints),
    seniority: classifySeniority(title, raw.seniorityHints ?? []),
    employmentType: classifyEmploymentType(title, raw.employmentTypeHints ?? []),
    salary,
    salaryMinUsdYear: annualUsd(salary),
    skills: extractSkills(title, tags, description),
    tags,
    description,
    postedAt: postedAt && postedAt > now ? now : postedAt,
    expiresAt: toIsoDate(raw.expiresAt),
    fingerprint: fingerprint(company, title),
  };
}
