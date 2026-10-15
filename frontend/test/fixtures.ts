import type { Job, JobDetail, Stats } from '../src/api/types';

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'greenhouse:1',
    source: 'greenhouse',
    sourceName: 'Greenhouse',
    externalId: '1',
    title: 'Senior Frontend Engineer',
    company: 'Acme',
    companyLogo: null,
    companyTier: 'S',
    url: 'https://example.com/jobs/1',
    locations: ['Remote - Worldwide'],
    workplace: 'remote',
    allowedCountries: null,
    category: 'software-development',
    seniority: 'senior',
    employmentType: 'full_time',
    salary: { min: 150_000, max: 180_000, currency: 'USD', period: 'year' },
    salaryMinUsdYear: 150_000,
    skills: ['TypeScript', 'React'],
    tags: [],
    postedAt: '2026-10-01T00:00:00Z',
    expiresAt: null,
    firstSeenAt: '2026-10-01T00:00:00Z',
    lastSeenAt: '2026-10-15T00:00:00Z',
    ...overrides,
  };
}

export function makeDetail(overrides: Partial<JobDetail> = {}): JobDetail {
  return { ...makeJob(), description: 'About us\n\nWe build things.', closedAt: null, alsoOn: [], ...overrides };
}

export const stats: Stats = {
  totals: { openJobs: 2, companies: 2, remote: 1, withSalary: 1, newLast7Days: 1, postedToday: 0 },
  categories: [
    { id: 'software-development', name: 'Software Development', count: 1 },
    { id: 'design', name: 'Design', count: 1 },
    { id: 'other', name: 'All Others', count: 0 },
  ],
  skills: [{ name: 'TypeScript', count: 1 }],
  countries: ['BR', 'US'],
  tiers: { S: 1 },
  sources: [],
  lastUpdatedAt: '2026-10-15T00:00:00Z',
};
