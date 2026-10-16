import https from "node:https";

const USER_AGENT = "job-radar/0.2 (+https://github.com/wellingtonfjr/job-radar)";
const DEFAULT_TIMEOUT_MS = 20_000;

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} responded ${status}`);
    this.name = "HttpError";
  }
}

/**
 * GET + JSON with a timeout and one retry on network errors / 5xx / 429.
 * 4xx responses are not retried: they mean the board doesn't exist or the
 * request is wrong, and retrying only adds load on the provider.
 */
export async function getJson<T>(
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, headers = {} as Record<string, string> } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new HttpError(url, res.status);
      return (await res.json()) as T;
    } catch (err) {
      const retryable = !(err instanceof HttpError) || err.status >= 500 || err.status === 429;
      if (!retryable || attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, to be polite to providers. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index] as T) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** GET returning the body as text (for public listing pages). */
export async function getText(url: string, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(url, res.status);
  return res.text();
}

/**
 * Whether a URL still resolves to a page. Bot walls (401/403/405/429) count
 * as reachable: the page exists, it just won't talk to scripts. 404/410
 * and network failures do not.
 *
 * Uses node:https rather than fetch: we only need the status line, and
 * interrupting a fetch body mid-download (cancel or abort) can throw an
 * uncaught error in Node 20's undici that takes the whole process down.
 */
export function isReachable(url: string, { timeoutMs = 15_000, redirectsLeft = 5 } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    if (target.protocol !== "https:") {
      resolve(false);
      return;
    }
    const req = https.get(target, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      res.destroy();
      if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
        resolve(isReachable(new URL(location, target).toString(), { timeoutMs, redirectsLeft: redirectsLeft - 1 }));
        return;
      }
      resolve((status >= 200 && status < 300) || [401, 403, 405, 429].includes(status));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(false));
  });
}
