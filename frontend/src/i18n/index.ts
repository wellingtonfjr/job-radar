import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { Salary } from '../api/types';
import { ageOf, countryName, formatCount, formatDate, formatRelative, formatSalary, locationChips } from '../lib/format';
import { en, type Messages } from './en';
import { getLocale, subscribeLocale, type Locale } from './locale';
import { ptBR } from './pt-BR';

export { detectLocale, LOCALES, setLocale, type Locale } from './locale';
export type { Messages } from './en';

const MESSAGES: Record<Locale, Messages> = { en, 'pt-BR': ptBR };

/** The formatting helpers, bound to one locale and its dictionary. */
function formatters(locale: Locale, t: Messages) {
  return {
    count: (value: number) => formatCount(value, locale),
    percent: (ratio: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
    relative: (iso: string) => formatRelative(iso, locale),
    date: (iso: string | null) => formatDate(iso, locale),
    salary: (salary: Salary | null) => formatSalary(salary, locale, t.periodSuffix),
    country: (code: string) => countryName(code, locale),
    /** Compact age for list rows: "3h", "6d" (en); "3 h", "6 d" (pt-BR). */
    age: (iso: string | null, now?: number) => {
      const age = ageOf(iso, now);
      return age && t.row.age(age.value, age.unit);
    },
    locations: (locations: string[], workplace: string, allowedCountries: string[] | null, max?: number) =>
      locationChips(locations, workplace, allowedCountries, { worldwide: t.row.worldwide, more: t.row.moreLocations }, max),
    /** Category label by id; unknown ids fall back to the API's (English) name. */
    category: (id: string, fallback?: string) => (t.category as Record<string, string | undefined>)[id] ?? fallback ?? id,
    plural: (forms: { one: string; other: string }, count: number) => (count === 1 ? forms.one : forms.other),
  };
}

export interface I18n {
  locale: Locale;
  t: Messages;
  fmt: ReturnType<typeof formatters>;
}

const bundles = new Map<Locale, I18n>();

/** Text and formatters for a locale (the same object on every call). */
export function i18n(locale: Locale): I18n {
  let bundle = bundles.get(locale);
  if (!bundle) {
    const t = MESSAGES[locale];
    bundle = { locale, t, fmt: formatters(locale, t) };
    bundles.set(locale, bundle);
  }
  return bundle;
}

/** The active locale's text and formatters; re-renders when the language changes. */
export function useI18n(): I18n {
  return i18n(useSyncExternalStore(subscribeLocale, getLocale, getLocale));
}

/** Fills `{name}` placeholders in a dictionary template with elements. */
export function rich(template: string, values: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/\{(\w+)\}/);
  return createElement(Fragment, null, ...parts.map((part, i) => (i % 2 === 1 ? values[part] : part)));
}

/** User-facing text for a failed API call. */
export function errorMessage(error: unknown, t: Messages): string {
  if (!(error instanceof ApiError)) return t.errors.generic;
  if (error.unreachable) return t.errors.unreachable;
  if (error.status === 429) return t.errors.rateLimited;
  return t.errors.requestFailed(error.status);
}
