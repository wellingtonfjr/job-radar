import type { EmploymentType, PayTier, Seniority, Workplace } from '../api/types';

/**
 * Listing filters. URL parameter names deliberately match the API's, so a
 * shared link, the browser URL and the API request are the same thing.
 */
export interface Filters {
  q: string;
  category: string[];
  country: string;
  workplace: Workplace[];
  seniority: Seniority[];
  type: EmploymentType[];
  skills: string[];
  tier: PayTier[];
  minSalary: number | null;
  postedWithin: number | null;
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  category: [],
  country: '',
  workplace: [],
  seniority: [],
  type: [],
  skills: [],
  tier: [],
  minSalary: null,
  postedWithin: null,
};

const WORKPLACES: readonly Workplace[] = ['remote', 'hybrid', 'onsite'];
const SENIORITIES: readonly Seniority[] = ['intern', 'junior', 'mid', 'senior', 'lead', 'executive'];
const TYPES: readonly EmploymentType[] = ['full_time', 'part_time', 'contract', 'freelance', 'internship', 'temporary'];
const TIERS: readonly PayTier[] = ['S', 'A', 'B'];

function list(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function oneOf<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const country = (params.get('country') ?? '').trim().toUpperCase();
  return {
    q: params.get('q') ?? '',
    category: list(params, 'category'),
    country: /^[A-Z]{2}$/.test(country) ? country : '',
    workplace: oneOf(list(params, 'workplace'), WORKPLACES),
    seniority: oneOf(list(params, 'seniority'), SENIORITIES),
    type: oneOf(list(params, 'type'), TYPES),
    skills: list(params, 'skills'),
    tier: oneOf(list(params, 'tier'), TIERS),
    minSalary: positiveInt(params.get('minSalary')),
    postedWithin: positiveInt(params.get('postedWithin')),
  };
}

export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  const lists: [keyof Filters, string[]][] = [
    ['category', filters.category],
    ['workplace', filters.workplace],
    ['seniority', filters.seniority],
    ['type', filters.type],
    ['skills', filters.skills],
    ['tier', filters.tier],
  ];
  for (const [key, values] of lists) if (values.length > 0) params.set(key, values.join(','));
  if (filters.country) params.set('country', filters.country);
  if (filters.minSalary) params.set('minSalary', String(filters.minSalary));
  if (filters.postedWithin) params.set('postedWithin', String(filters.postedWithin));
  return params.toString();
}

/** Number of active filters, excluding the search text. */
export function countActiveFilters(filters: Filters): number {
  return (
    filters.category.length +
    filters.workplace.length +
    filters.seniority.length +
    filters.type.length +
    filters.skills.length +
    filters.tier.length +
    (filters.country ? 1 : 0) +
    (filters.minSalary ? 1 : 0) +
    (filters.postedWithin ? 1 : 0)
  );
}

export function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}
