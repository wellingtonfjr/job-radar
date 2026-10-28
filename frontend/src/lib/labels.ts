// Display order of the option sets; their text lives in the i18n dictionaries.

/** Category ids from the backend (backend/src/domain/job.ts). */
export const CATEGORY_IDS = [
  'software-development',
  'devops',
  'data',
  'ai-ml',
  'qa',
  'security',
  'product',
  'design',
  'marketing',
  'sales',
  'customer-support',
  'operations',
  'finance',
  'legal',
  'hr',
  'writing',
  'education',
  'healthcare',
  'other',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export const POSTED_WITHIN_DAYS = [1, 3, 7, 30] as const;

export const MIN_SALARY_OPTIONS = [40_000, 60_000, 80_000, 100_000, 120_000, 150_000, 200_000] as const;
