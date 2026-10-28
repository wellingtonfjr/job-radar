import type { Salary, SalaryPeriod } from '../api/types';

// Pure formatting helpers. Each takes the locale explicitly; components get
// them pre-bound to the active locale from `useI18n().fmt`.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type AgeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

/** Age in the largest sensible unit, for compact list rows ("3h", "6d", "2wk"). */
export function ageOf(iso: string | null, now: number = Date.now()): { value: number; unit: AgeUnit } | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const diff = Math.max(0, now - time);
  if (diff < HOUR) return { value: Math.max(1, Math.round(diff / MINUTE)), unit: 'minute' };
  if (diff < DAY) return { value: Math.round(diff / HOUR), unit: 'hour' };
  if (diff < 14 * DAY) return { value: Math.round(diff / DAY), unit: 'day' };
  if (diff < 60 * DAY) return { value: Math.round(diff / (7 * DAY)), unit: 'week' };
  return { value: Math.round(diff / (30 * DAY)), unit: 'month' };
}

/** Sentence form for freshness notes: "12 minutes ago", "há 3 horas". */
export function formatRelative(iso: string, locale: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MINUTE)), 'minute');
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), 'hour');
  return rtf.format(-Math.round(diff / DAY), 'day');
}

export function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAmount(value: number, currency: string | null, compact: boolean, locale: string): string {
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: compact ? 1 : value < 100 ? 2 : 0,
    minimumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard',
  };
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, { ...options, style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value);
    } catch {
      // Unknown currency code: fall through to a plain number + code.
    }
  }
  const number = new Intl.NumberFormat(locale, options).format(value);
  return currency ? `${number} ${currency}` : number;
}

/** "$170K – $200K", "€60K", "$50 – $75/hr" (en); "$ 170 mil – $ 200 mil" (pt-BR). */
export function formatSalary(salary: Salary | null, locale: string, periodSuffix: Record<SalaryPeriod, string>): string | null {
  if (!salary || (salary.min === null && salary.max === null)) return null;
  const compact = salary.period === 'year' || salary.period === 'month';
  const parts = [salary.min, salary.max]
    .filter((v, i, arr): v is number => v !== null && (i === 0 || v !== arr[0]))
    .map((v) => formatAmount(v, salary.currency, compact, locale));
  return `${parts.join(' – ')}${periodSuffix[salary.period]}`;
}

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

const regionNames = new Map<string, Intl.DisplayNames | null>();

export function countryName(code: string, locale: string): string {
  try {
    if (!regionNames.has(locale)) regionNames.set(locale, new Intl.DisplayNames([locale], { type: 'region' }));
    return regionNames.get(locale)?.of(code) ?? code;
  } catch {
    return code;
  }
}

const MODE = String.raw`(?:fully\s+)?(?:remote|hybrid|on-?site)`;
const MODE_PREFIX = new RegExp(String.raw`^${MODE}(?:\s+jobs?)?\b\s*(?:[-–—:,/|]\s*)?`, 'i');
const MODE_SUFFIX = new RegExp(String.raw`\s*(?:[-–—,/|]\s*)?\(\s*${MODE}\s*\)$|\s*[-–—,/|]\s*${MODE}$`, 'i');

/**
 * Drops work-mode words the card already shows: "Remote - USA" → "USA",
 * "United States (Remote)" → "United States", "Germany (Hybrid)" → "Germany".
 */
export function cleanLocation(location: string): string {
  let s = location.trim().replace(MODE_PREFIX, '');
  if (/^\(.*\)$/.test(s)) s = s.slice(1, -1);
  return s.replace(MODE_SUFFIX, '').trim();
}

/** "Worldwide", or the posting's own locations with a "+N more" overflow. */
export function locationChips(
  locations: string[],
  workplace: string,
  allowedCountries: string[] | null,
  labels: { worldwide: string; more: (count: number) => string },
  max = 3,
): string[] {
  if (workplace === 'remote' && allowedCountries === null) return [labels.worldwide];
  const cleaned = Array.from(new Set(locations.map(cleanLocation).filter(Boolean)));
  if (cleaned.length === 0) return [];
  const shown = cleaned.slice(0, max);
  return cleaned.length > max ? [...shown, labels.more(cleaned.length - max)] : shown;
}
