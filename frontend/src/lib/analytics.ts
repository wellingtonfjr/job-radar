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

/** Removes the search text from one of our own URLs; other strings pass through. */
export function stripSearchText(value: string, origin = window.location.origin): string {
  if (!value.startsWith(origin)) return value;
  const url = new URL(value);
  if (!url.searchParams.has('q')) return value;
  url.searchParams.delete('q');
  return url.toString();
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
      for (const [key, value] of Object.entries(event.properties)) {
        if (typeof value === 'string') event.properties[key] = stripSearchText(value);
      }
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
  window.addEventListener('error', (event) => captureError(event.error ?? event.message, { source: 'window.onerror' }));
  window.addEventListener('unhandledrejection', (event) => captureError(event.reason, { source: 'unhandledrejection' }));
}

/**
 * Sends a JavaScript error to PostHog Error Tracking (stack included), with
 * the page it happened on. A no-op when analytics is off.
 */
export function captureError(error: unknown, props: EventProps = {}): void {
  if (!client) return;
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  void client.then((posthog) => posthog?.captureException(err, { runtime: 'browser', ...props }));
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
