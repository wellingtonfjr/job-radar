import { describe, expect, it } from 'vitest';
import { countActiveFilters, EMPTY_FILTERS, parseFilters, serializeFilters, toggle } from '../src/lib/filters';
import { formatAge, formatSalary, locationChips } from '../src/lib/format';
import { matchRoute } from '../src/lib/router';

describe('filters', () => {
  it('round-trips through the URL', () => {
    const filters = {
      ...EMPTY_FILTERS,
      q: 'react',
      category: ['design', 'software-development'],
      country: 'BR',
      workplace: ['remote' as const],
      skills: ['TypeScript', 'C#'],
      minSalary: 100_000,
      postedWithin: 7,
    };
    expect(parseFilters(`?${serializeFilters(filters)}`)).toEqual(filters);
  });

  it('drops invalid values from hand-edited URLs', () => {
    expect(parseFilters('?workplace=remote,moon&country=Brazil&minSalary=-5&tier=Z')).toEqual({ ...EMPTY_FILTERS, workplace: ['remote'] });
    expect(parseFilters('?country=br').country).toBe('BR');
  });

  it('serializes empty filters to an empty query', () => {
    expect(serializeFilters(EMPTY_FILTERS)).toBe('');
  });

  it('counts active filters, ignoring search text', () => {
    expect(countActiveFilters({ ...EMPTY_FILTERS, q: 'x', category: ['a', 'b'], country: 'BR' })).toBe(3);
  });

  it('toggles values', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('format', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');

  it.each([
    ['2026-10-15T11:30:00Z', '30m ago'],
    ['2026-10-15T07:00:00Z', '5h ago'],
    ['2026-10-09T12:00:00Z', '6d ago'],
    ['2026-09-24T12:00:00Z', '3wk ago'],
    ['2026-06-15T12:00:00Z', '4mo ago'],
  ])('formatAge(%s) = %s', (iso, expected) => {
    expect(formatAge(iso, now)).toBe(expected);
  });

  it('formats salaries compactly with currency and period', () => {
    expect(formatSalary({ min: 170_000, max: 200_000, currency: 'USD', period: 'year' })).toBe('$170K – $200K');
    expect(formatSalary({ min: 60_000, max: null, currency: 'EUR', period: 'year' })).toBe('€60K');
    expect(formatSalary({ min: 50, max: 75, currency: 'USD', period: 'hour' })).toBe('$50 – $75/hr');
    expect(formatSalary({ min: 90_000, max: 90_000, currency: 'GBP', period: 'year' })).toBe('£90K');
    expect(formatSalary(null)).toBeNull();
  });

  it('shows Worldwide for unrestricted remote jobs and caps location chips', () => {
    expect(locationChips(['Remote'], 'remote', null)).toEqual(['Worldwide']);
    expect(locationChips(['A', 'B', 'C', 'D', 'E'], 'remote', ['US'])).toEqual(['A', 'B', 'C', '+2 more']);
    expect(locationChips(['Berlin'], 'onsite', null)).toEqual(['Berlin']);
  });
});

describe('matchRoute', () => {
  it('matches list, detail and unknown paths', () => {
    expect(matchRoute('/')).toEqual({ name: 'jobs' });
    expect(matchRoute('/jobs/greenhouse%3A1')).toEqual({ name: 'job', id: 'greenhouse:1' });
    expect(matchRoute('/nope')).toEqual({ name: 'not-found' });
  });
});
