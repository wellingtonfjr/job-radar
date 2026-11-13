import { PostHog } from "posthog-node";

/**
 * Error tracking: every unexpected server error is logged and, when
 * POSTHOG_KEY is set (production), also sent to PostHog Error Tracking, so
 * failures show up with their stack instead of only in the Fly logs.
 *
 * Only the error and where it happened are sent (no request data, no
 * visitor IP: geo-IP lookup is off). Expected failures (a job board rate
 * limiting us, one company board 404ing) are not errors here.
 */

/** Where an error happened, e.g. "api", "ingest", "accuracy". */
export type ErrorArea = string;

export interface ErrorReporter {
  capture(error: unknown, properties: Record<string, unknown>): void;
  /** Sends what's queued; called before the process exits. */
  flush(): Promise<void>;
}

const NOOP: ErrorReporter = { capture: () => {}, flush: () => Promise.resolve() };

let reporter: ErrorReporter = NOOP;

/** The reporter used by reportError; tests swap in a fake. */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next ?? NOOP;
}

export function createPostHogReporter({ key, host }: { key: string; host: string }): ErrorReporter {
  const client = new PostHog(key, { host, flushAt: 1, flushInterval: 5_000, disableGeoip: true });
  return {
    // No person profile for the server: its errors aren't a visitor.
    capture: (error, properties) => client.captureException(error, SERVER_DISTINCT_ID, { ...properties, $process_person_profile: false }),
    flush: () => client.flush(),
  };
}

/** One "person" for every server-side error, so they don't count as visitors. */
const SERVER_DISTINCT_ID = "job-radar-server";

/**
 * Logs an unexpected error as before (`[area] message: error`) and sends it
 * to error tracking. Never throws: reporting must not break the caller.
 */
export function reportError(area: ErrorArea, message: string, error: unknown, extra: Record<string, unknown> = {}): void {
  console.error(`[${area}] ${message}:`, error);
  try {
    reporter.capture(error instanceof Error ? error : new Error(String(error)), { area, context: message, runtime: "server", ...extra });
  } catch {
    // Reporting failures are not worth crashing for.
  }
}

/**
 * Sends what's queued, giving up after `timeoutMs`: with PostHog
 * unreachable a flush retries for ~17 s, longer than Fly waits for a
 * stopping machine, which would leave a crashed process serving.
 */
export function flushErrors(timeoutMs = 2_000): Promise<void> {
  return Promise.race([reporter.flush().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref())]);
}
