import { getJson, getText, HttpError, isReachable } from "../sources/http.js";

/** The network calls the resolver makes; swapped for fakes in tests. */
export interface ResolverNet {
  /** JSON body, or `null` when the resource doesn't exist (404/410). */
  json<T>(url: string, headers?: Record<string, string>): Promise<T | null>;
  text(url: string): Promise<string | null>;
  reachable(url: string): Promise<boolean>;
}

async function orNullOnMissing<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 410)) return null;
    throw err;
  }
}

export const liveNet: ResolverNet = {
  json: <T>(url: string, headers?: Record<string, string>) => orNullOnMissing(() => getJson<T>(url, { retries: 0, headers })),
  text: (url) => orNullOnMissing(() => getText(url)),
  reachable: (url) => isReachable(url),
};
