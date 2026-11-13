import type { PostHog, PostHogConfig } from 'posthog-js/dist/module.slim.no-external';
import type { Job, JobDetail } from '../api/types';
import { countActiveFilters, type Filters } from './filters';

/**
 * Anonymous product analytics through PostHog: how many people visit, which
 * pages they open, which filters they combine and which roles they apply to.
 *
 * Privacy, on purpose:
 * - Cookieless: nothing is stored in the browser; PostHog counts unique
 *   visitors with a daily server-side hash (the project must have
 *   cookieless mode enabled in its settings, or events are dropped).
 * - Only the events below, plus JavaScript errors (see captureError). No
 *   autocapture, session replay, surveys, heatmaps or external scripts.
 * - The search text never leaves the browser: `q` is stripped from every URL
 *   and events only carry its length.
 * - Do Not Track is respected.
 *
 * Off unless the build sets VITE_POSTHOG_KEY, and never in dev or tests.
 * The SDK is imported lazily, so the main bundle doesn't grow.
 */

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

type Value = string | number | boolean | null | readonly string[];
export type EventProps = Record<string, Value>;

let client: Promise<PostHog | null> | null = null;

export function analyticsEnabled(): boolean {
  return Boolean(KEY) && import.meta.env.PROD;
}

/** Removes the search text from our own URLs, wherever they appear in the string. */
export function stripSearchText(value: string, origin = window.location.origin): string {
  if (!value.includes(origin)) return value;
  const ownUrl = new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s"'<>]*`, 'g');
  return value.replace(ownUrl, (match) => {
    const url = new URL(match);
    if (!url.searchParams.has('q')) return match;
    url.searchParams.delete('q');
    return url.toString();
  });
}

/** stripSearchText on every string, however nested (e.g. inside $exception_list). */
export function stripSearchTextDeep(value: unknown, origin = window.location.origin): unknown {
  if (typeof value === 'string') return stripSearchText(value, origin);
  if (Array.isArray(value)) return value.map((v) => stripSearchTextDeep(v, origin));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripSearchTextDeep(v, origin)]));
  }
  return value;
}

export function initAnalytics(): void {
  if (client || !analyticsEnabled()) return;
  const config: Partial<PostHogConfig> = {
    api_host: HOST,
    cookieless_mode: 'always',
    respect_dnt: true,
    person_profiles: 'never',
    // App.tsx captures one $pageview per route; typing in the search box
    // rewrites the URL and must not count as a page.
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    // No feature flags or remote config: the only request is sending events,
    // so the CSP allows just the ingestion host.
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    before_send: (event) => {
      if (!event) return null;
      event.properties = stripSearchTextDeep(event.properties) as typeof event.properties;
      return event;
    },
  };
  client = Promise.all([import('posthog-js/dist/module.slim.no-external'), import('./posthogErrorTracking')])
    .then(([{ default: posthog }, { ErrorTrackingExtensions }]) => {
      // Error tracking is bundled here instead of loaded as an external
      // script (capture_exceptions stays off: it needs one); the window
      // listeners below feed it instead.
      posthog.init(KEY!, { ...config, __extensionClasses: { ...ErrorTrackingExtensions } } as Partial<PostHogConfig>);
      return posthog;
    })
    .catch(() => null); // Blocked or failed to load: the site works the same.
  // No error object: a cross-origin "Script error." or a resource failing to
  // load, nothing we can act on.
  window.addEventListener('error', (event) => {
    if (event.error != null) captureError(event.error, { source: 'window.onerror' });
  });
  window.addEventListener('unhandledrejection', (event) => captureError(event.reason, { source: 'unhandledrejection' }));
}

/**
 * Sends a JavaScript error to PostHog Error Tracking (stack included), with
 * the page it happened on. A no-op when analytics is off.
 */
export function captureError(error: unknown, props: EventProps = {}): void {
  if (!client || !shouldSend(error)) return;
  // Raw values go as they are: PostHog turns strings, objects and events
  // into exceptions itself.
  void client.then((posthog) => posthog?.captureException(error, { runtime: 'browser', ...props }));
}

/** At most this many errors per page load, each distinct one once. */
export const MAX_ERRORS_PER_PAGE = 10;
const sentErrors = new Set<string>();

/**
 * An error repeating in a loop (a render loop, a polling bug) would
 * otherwise send thousands of events per hour from one tab and use up the
 * event budget the analytics need.
 */
export function shouldSend(error: unknown): boolean {
  const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (sentErrors.has(key) || sentErrors.size >= MAX_ERRORS_PER_PAGE) return false;
  sentErrors.add(key);
  return true;
}

export function track(event: string, props: EventProps = {}): void {
  void client?.then((posthog) => posthog?.capture(event, props));
}

export function trackPageview(page: string): void {
  track('$pageview', { page });
}

/** What was searched, without the search text itself. */
export function searchProps(filters: Filters, results: number): EventProps {
  const q = filters.q.trim();
  return {
    has_search: q !== '',
    search_length: q.length,
    filter_count: countActiveFilters(filters),
    category: filters.category,
    workplace: filters.workplace,
    seniority: filters.seniority,
    type: filters.type,
    skills: filters.skills,
    tier: filters.tier,
    country: filters.country || null,
    min_salary: filters.minSalary,
    posted_within: filters.postedWithin,
    direct_only: filters.direct,
    results,
  };
}

/** The role's shape, never who looked at it. */
export function jobProps(job: Job | JobDetail): EventProps {
  return {
    job_id: job.id,
    source: job.source,
    company: job.company,
    category: job.category,
    seniority: job.seniority,
    workplace: job.workplace,
    apply_direct: job.applyDirect,
    has_salary: job.salary !== null,
  };
}
