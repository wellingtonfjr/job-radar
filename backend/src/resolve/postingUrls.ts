import { decodeEntities } from "../normalize/html.js";

/**
 * Recognizes URLs of a *specific job posting* on an applicant-tracking
 * system (ATS). These are the employer's own job descriptions, as opposed
 * to job-board pages or a company's generic careers homepage, so only
 * links matching one of these shapes are trusted as direct links.
 */
const POSTING_PATTERNS: RegExp[] = [
  /^https:\/\/(boards|job-boards)(\.eu)?\.greenhouse\.io\/[\w-]+\/jobs\/\d+/i,
  /^https:\/\/[^/]+\/[^?#]*[?&]gh_jid=\d+/i,
  /^https:\/\/jobs(\.eu)?\.lever\.co\/[\w.-]+\/[0-9a-f-]{36}/i,
  /^https:\/\/jobs\.ashbyhq\.com\/[\w.%-]+\/[0-9a-f-]{36}/i,
  /^https:\/\/apply\.workable\.com\/[\w-]+\/j\/[0-9A-F]+/i,
  /^https:\/\/[\w-]+\.recruitee\.com\/o\/[\w-]+/i,
  /^https:\/\/(jobs|careers)\.smartrecruiters\.com\/[\w-]+\/\d+/i,
  /^https:\/\/[\w-]+\.jobs\.personio\.(de|com)\/job\/\d+/i,
  /^https:\/\/[\w-]+\.teamtailor\.com\/jobs\/\d+/i,
  /^https:\/\/[\w-]+\.bamboohr\.com\/careers\/\d+/i,
  /^https:\/\/[\w-]+\.wd\d+\.myworkdayjobs\.com\/.+\/job\/.+/i,
  /^https:\/\/jobs\.jobvite\.com\/[\w-]+\/job\/\w+/i,
  /^https:\/\/[\w-]+\.breezy\.hr\/p\/[\w-]+/i,
  /^https:\/\/join\.com\/companies\/[\w-]+\/\d+/i,
  /^https:\/\/(careers-)?[\w-]+\.icims\.com\/jobs\/\d+/i,
  /^https:\/\/[\w-]+\.inhire\.app\/vagas\/[0-9a-f-]{36}/i,
];

const TRACKING_PARAM = /^(utm_[a-z]+|ref|referrer|source|src|gh_src|lever-source|lever-origin|fbclid|gclid)$/i;

/** Removes tracking parameters; keeps ids like `gh_jid`. Returns null for non-https URLs. */
export function cleanUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(decodeEntities(raw.trim()));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

export function isPostingUrl(url: string): boolean {
  return POSTING_PATTERNS.some((pattern) => pattern.test(url));
}

/** ATS job-posting links mentioned in a description (hrefs and bare URLs). */
export function extractPostingLinks(html: string | null | undefined): string[] {
  if (!html) return [];
  const candidates = [
    ...[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1] as string),
    ...[...html.matchAll(/https:\/\/[^\s"'<>)\]]+/gi)].map((m) => m[0]),
  ];
  const links = new Set<string>();
  for (const candidate of candidates) {
    const cleaned = cleanUrl(candidate.replace(/[.,;:!?]+$/, ""));
    if (cleaned && isPostingUrl(cleaned)) links.add(cleaned);
  }
  return [...links];
}
