import { useSyncExternalStore } from 'react';

/**
 * Minimal History-API router: the app has three routes (list, detail and
 * saved), so a routing dependency isn't worth it. `navigate` pushes state and notifies
 * subscribers; back/forward arrive via `popstate`.
 */
const NAVIGATE_EVENT = 'job-radar:navigate';

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener(NAVIGATE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

export function useLocation(): { pathname: string; search: string } {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  return { pathname: url.pathname, search: url.search };
}

export function navigate(to: string, { replace = false } = {}): void {
  if (to === snapshot()) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export type Route = { name: 'jobs' } | { name: 'job'; id: string } | { name: 'saved' } | { name: 'not-found' };

export const SAVED_PATH = '/saved';

export function matchRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'jobs' };
  if (pathname === SAVED_PATH || pathname === `${SAVED_PATH}/`) return { name: 'saved' };
  const match = pathname.match(/^\/jobs\/([^/]+)\/?$/);
  if (match?.[1]) return { name: 'job', id: decodeURIComponent(match[1]) };
  return { name: 'not-found' };
}

export function jobPath(id: string): string {
  return `/jobs/${encodeURIComponent(id)}`;
}
