// Mirrors the backend contract (backend/src/domain/job.ts, backend/src/api).

export type Workplace = 'remote' | 'hybrid' | 'onsite';
export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'executive';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'freelance' | 'internship' | 'temporary';
export type PayTier = 'S' | 'A' | 'B';
export type SalaryPeriod = 'year' | 'month' | 'week' | 'day' | 'hour';

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod;
}

export interface Job {
  id: string;
  source: string;
  sourceName: string;
  externalId: string;
  title: string;
  company: string;
  companyLogo: string | null;
  companyTier: PayTier | null;
  /** The source listing. */
  url: string;
  /** Where "Apply" goes: the employer's own posting when known, else `url`. */
  applyUrl: string;
  applyDirect: boolean;
  locations: string[];
  workplace: Workplace;
  allowedCountries: string[] | null;
  category: string;
  seniority: Seniority | null;
  employmentType: EmploymentType | null;
  salary: Salary | null;
  salaryMinUsdYear: number | null;
  skills: string[];
  tags: string[];
  postedAt: string | null;
  expiresAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface JobDetail extends Job {
  description: string | null;
  closedAt: string | null;
  /** How the direct link was found ("source" = the job came from the employer's ATS). */
  applyMethod: 'source' | 'ats-match' | 'description' | 'listing-page' | 'ats-discovery' | null;
  alsoOn: { source: string; sourceName: string; url: string }[];
}

export interface JobsResponse {
  jobs: Job[];
  total: number;
  /** How many of the matching roles were posted in the last 7 days. */
  newLast7Days: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SourceStatus {
  id: string;
  name: string;
  kind: 'ats' | 'aggregator';
  homepage: string;
  openJobs: number;
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    status: string;
    fetched: number;
    inserted: number;
    closed: number;
    errorCount: number;
  } | null;
}

export interface Stats {
  totals: {
    openJobs: number;
    companies: number;
    remote: number;
    withSalary: number;
    newLast7Days: number;
    postedToday: number;
  };
  categories: { id: string; name: string; count: number }[];
  skills: { name: string; count: number }[];
  countries: string[];
  tiers: Partial<Record<PayTier, number>>;
  sources: SourceStatus[];
  lastUpdatedAt: string | null;
}
