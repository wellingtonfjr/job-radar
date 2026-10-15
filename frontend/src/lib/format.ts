import type { Salary } from '../api/types';
import { PERIOD_SUFFIX } from './labels';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age for list rows: "3h ago", "6d ago", "2wk ago", "3mo ago". */
export function formatAge(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const diff = Math.max(0, now - time);
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  if (diff < 14 * DAY) return `${Math.round(diff / DAY)}d ago`;
  if (diff < 60 * DAY) return `${Math.round(diff / (7 * DAY))}wk ago`;
  return `${Math.round(diff / (30 * DAY))}mo ago`;
}

/** Sentence form for freshness notes: "12 minutes ago", "3 hours ago". */
export function formatRelative(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const diff = Math.max(0, now - Date.parse(iso));
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MINUTE)), 'minute');
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), 'hour');
  return rtf.format(-Math.round(diff / DAY), 'day');
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAmount(value: number, currency: string | null, compact: boolean): string {
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: compact ? 1 : value < 100 ? 2 : 0,
    minimumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard',
  };
  if (currency) {
    try {
      return new Intl.NumberFormat('en', { ...options, style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value);
    } catch {
      // Unknown currency code: fall through to a plain number + code.
    }
  }
  const number = new Intl.NumberFormat('en', options).format(value);
  return currency ? `${number} ${currency}` : number;
}

/** "$170K – $200K", "€60K", "$50 – $75/hr". */
export function formatSalary(salary: Salary | null): string | null {
  if (!salary || (salary.min === null && salary.max === null)) return null;
  const compact = salary.period === 'year' || salary.period === 'month';
  const parts = [salary.min, salary.max]
    .filter((v, i, arr): v is number => v !== null && (i === 0 || v !== arr[0]))
    .map((v) => formatAmount(v, salary.currency, compact));
  return `${parts.join(' – ')}${PERIOD_SUFFIX[salary.period]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

let regionNames: Intl.DisplayNames | null = null;

export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Worldwide", or the posting's own locations with a "+N more" overflow. */
export function locationChips(locations: string[], workplace: string, allowedCountries: string[] | null, max = 3): string[] {
  if (workplace === 'remote' && allowedCountries === null) return ['Worldwide'];
  if (locations.length === 0) return [];
  const shown = locations.slice(0, max);
  return locations.length > max ? [...shown, `+${locations.length - max} more`] : shown;
}
