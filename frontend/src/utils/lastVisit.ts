const LAST_VISIT_KEY = 'job-radar:lastVisit';

/** Reads the stored last-visit timestamp without updating it. */
export function getLastVisit(): string | null {
  try {
    return window.localStorage.getItem(LAST_VISIT_KEY);
  } catch {
    // localStorage can throw in private-browsing / disabled-storage contexts.
    return null;
  }
}

/** Stamps "now" as the last-visit timestamp, for next time. */
export function setLastVisitNow(): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  } catch {
    // Ignore - "new" badges just won't persist across visits in this browser.
  }
}
