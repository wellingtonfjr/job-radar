/**
 * Shared domain model. Every source adapter produces `RawJob`s; the
 * normalization layer turns them into `NormalizedJob`s (consistent category,
 * seniority, employment type, salary and location data), which is what gets
 * stored and served.
 */

export const CATEGORIES = [
  { id: "software-development", name: "Software Development" },
  { id: "devops", name: "DevOps & Infrastructure" },
  { id: "data", name: "Data & Analytics" },
  { id: "ai-ml", name: "AI & Machine Learning" },
  { id: "qa", name: "QA & Testing" },
  { id: "security", name: "Security" },
  { id: "product", name: "Product" },
  { id: "design", name: "Design" },
  { id: "marketing", name: "Marketing" },
  { id: "sales", name: "Sales & Business Development" },
  { id: "customer-support", name: "Customer Support" },
  { id: "operations", name: "Operations" },
  { id: "finance", name: "Finance & Accounting" },
  { id: "legal", name: "Legal & Compliance" },
  { id: "hr", name: "HR & Recruiting" },
  { id: "writing", name: "Writing & Content" },
  { id: "education", name: "Education" },
  { id: "healthcare", name: "Healthcare" },
  { id: "other", name: "All Others" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const SENIORITIES = ["intern", "junior", "mid", "senior", "lead", "executive"] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "temporary",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const WORKPLACES = ["remote", "hybrid", "onsite"] as const;
export type Workplace = (typeof WORKPLACES)[number];

/**
 * Company pay tier, derived from the annual-USD salaries the company itself
 * publishes (median of its postings' lower bounds): S ≥ $120k, A ≥ $90k,
 * B ≥ $50k. `null` when the company publishes too few salaries to tell.
 */
export const PAY_TIERS = ["S", "A", "B"] as const;
export type PayTier = (typeof PAY_TIERS)[number];

export const SALARY_PERIODS = ["year", "month", "week", "day", "hour"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null; // ISO 4217
  period: SalaryPeriod;
}

/** What an adapter returns: as close to the source data as possible. */
export interface RawJob {
  externalId: string;
  title: string;
  company: string;
  companyLogo?: string | null;
  url: string;
  /** Free-text location(s) as given by the source. */
  locations: string[];
  /** Set when the source says so explicitly; `null` to infer from text. */
  workplace: Workplace | null;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  tags?: string[];
  /** Source-provided category/department/industry labels, used as hints. */
  categoryHints?: string[];
  seniorityHints?: string[];
  employmentTypeHints?: string[];
  salary?: Salary | null;
  salaryText?: string | null;
  postedAt?: string | null;
  expiresAt?: string | null;
}

export interface NormalizedJob {
  id: string;
  source: string;
  feed: string;
  externalId: string;
  title: string;
  company: string;
  companyLogo: string | null;
  url: string;
  locations: string[];
  workplace: Workplace;
  /** ISO 3166-1 alpha-2 codes; `null` = no restriction detected. */
  allowedCountries: string[] | null;
  category: CategoryId;
  seniority: Seniority | null;
  employmentType: EmploymentType | null;
  salary: Salary | null;
  /** Approximate annual USD lower bound, only used for filtering. */
  salaryMinUsdYear: number | null;
  /** Technologies detected in the title/description/tags (canonical names). */
  skills: string[];
  tags: string[];
  description: string | null;
  postedAt: string | null;
  expiresAt: string | null;
  fingerprint: string;
}

/** The public API shape for a job. */
export interface Job extends Omit<NormalizedJob, "feed" | "fingerprint" | "description"> {
  sourceName: string;
  companyTier: PayTier | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface JobDetail extends Job {
  description: string | null;
}
