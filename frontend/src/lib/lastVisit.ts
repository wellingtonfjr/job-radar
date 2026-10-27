const LAST_VISIT_KEY = 'job-radar:lastVisit';

// Memoized per page load, so repeated calls (e.g. StrictMode's double
// render) don't overwrite the previous visit with "now" before it's read.
let previousVisit: string | null | undefined;

/**
 * Returns the previous visit's timestamp and stamps "now" for next time, so
 * jobs first seen since then can be marked "New". Storage can be disabled
 * (private mode), in which case nothing is marked.
 */
export function takeLastVisit(): string | null {
  if (previousVisit !== undefined) return previousVisit;
  try {
    previousVisit = window.localStorage.getItem(LAST_VISIT_KEY);
    window.localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  } catch {
    previousVisit = null;
  }
  return previousVisit;
}
