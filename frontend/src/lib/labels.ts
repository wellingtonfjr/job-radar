import type { EmploymentType, PayTier, SalaryPeriod, Seniority, Workplace } from '../api/types';

export const WORKPLACE_LABELS: Record<Workplace, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

export const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  lead: 'Lead / Staff',
  executive: 'Director+',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  freelance: 'Freelance',
  internship: 'Internship',
  temporary: 'Temporary',
};

export const TIER_LABELS: Record<PayTier, string> = {
  S: 'Tier S · $120k+',
  A: 'Tier A · $90–120k',
  B: 'Tier B · $50–90k',
};

export const PERIOD_SUFFIX: Record<SalaryPeriod, string> = {
  year: '',
  month: '/mo',
  week: '/wk',
  day: '/day',
  hour: '/hr',
};

export const POSTED_OPTIONS = [
  { value: 1, label: 'Last 24 hours' },
  { value: 3, label: 'Last 3 days' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
] as const;

export const MIN_SALARY_OPTIONS = [40_000, 60_000, 80_000, 100_000, 120_000, 150_000, 200_000] as const;
