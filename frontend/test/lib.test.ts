import { describe, expect, it } from 'vitest';
import { countActiveFilters, EMPTY_FILTERS, parseFilters, serializeFilters, toggle } from '../src/lib/filters';
import { i18n } from '../src/i18n';
import { cleanLocation } from '../src/lib/format';
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
      direct: true,
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
  const en = i18n('en').fmt;
  const pt = i18n('pt-BR').fmt;

  it.each([
    ['2026-10-15T11:30:00Z', '30m', '30 min'],
    ['2026-10-15T07:00:00Z', '5h', '5 h'],
    ['2026-10-09T12:00:00Z', '6d', '6 d'],
    ['2026-09-24T12:00:00Z', '3wk', '3 sem'],
    ['2026-06-15T12:00:00Z', '4mo', '4 meses'],
  ])('age(%s) = %s / %s', (iso, english, portuguese) => {
    expect(en.age(iso, now)).toBe(english);
    expect(pt.age(iso, now)).toBe(portuguese);
  });

  it('formats salaries compactly with currency and period', () => {
    expect(en.salary({ min: 170_000, max: 200_000, currency: 'USD', period: 'year' })).toBe('$170K – $200K');
    expect(en.salary({ min: 60_000, max: null, currency: 'EUR', period: 'year' })).toBe('€60K');
    expect(en.salary({ min: 50, max: 75, currency: 'USD', period: 'hour' })).toBe('$50 – $75/hr');
    expect(en.salary({ min: 90_000, max: 90_000, currency: 'GBP', period: 'year' })).toBe('£90K');
    expect(en.salary(null)).toBeNull();
  });

  it('formats salaries the Brazilian way in pt-BR', () => {
    expect(pt.salary({ min: 170_000, max: 200_000, currency: 'USD', period: 'year' })).toBe('$\u00a0170\u00a0mil – $\u00a0200\u00a0mil');
    expect(pt.salary({ min: 50, max: 75, currency: 'USD', period: 'hour' })).toBe('$\u00a050 – $\u00a075/h');
  });

  it('formats numbers, dates and relative times per locale', () => {
    expect(en.count(20_980)).toBe('20,980');
    expect(pt.count(20_980)).toBe('20.980');
    expect(en.date('2026-10-01T12:00:00Z')).toBe('Oct 1, 2026');
    expect(pt.date('2026-10-01T12:00:00Z')).toBe('1 de out. de 2026');
    expect(en.relative('2026-10-15T09:00:00Z')).toMatch(/ago$/);
    expect(pt.relative('2026-10-15T09:00:00Z')).toMatch(/^há /);
    expect(pt.country('US')).toBe('Estados Unidos');
  });

  it('shows Worldwide for unrestricted remote jobs and caps location chips', () => {
    expect(en.locations(['Remote'], 'remote', null)).toEqual(['Worldwide']);
    expect(en.locations(['A', 'B', 'C', 'D', 'E'], 'remote', ['US'])).toEqual(['A', 'B', 'C', '+2 more']);
    expect(en.locations(['Berlin'], 'onsite', null)).toEqual(['Berlin']);
    expect(pt.locations(['Remote'], 'remote', null)).toEqual(['Qualquer lugar do mundo']);
  });

  it.each([
    ['Remote - USA', 'USA'],
    ['Remote, United States', 'United States'],
    ['United States (Remote)', 'United States'],
    ['Remote (Canada)', 'Canada'],
    ['USA - Remote', 'USA'],
    ['Remote', ''],
    ['Remote job', ''],
    ['Remotely, Berlin', 'Remotely, Berlin'],
    ['Germany (Hybrid)', 'Germany'],
    ['Hybrid - London', 'London'],
    ['Berlin (Mitte)', 'Berlin (Mitte)'],
    ['San Francisco, CA', 'San Francisco, CA'],
  ])('cleanLocation(%s) = %s', (input, expected) => {
    expect(cleanLocation(input)).toBe(expected);
  });
});

describe('matchRoute', () => {
  it('matches list, detail and unknown paths', () => {
    expect(matchRoute('/')).toEqual({ name: 'jobs' });
    expect(matchRoute('/jobs/greenhouse%3A1')).toEqual({ name: 'job', id: 'greenhouse:1' });
    expect(matchRoute('/nope')).toEqual({ name: 'not-found' });
  });
});
