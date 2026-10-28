import type { Accuracy, JobDetail, JobsResponse, ReportResult, Stats } from './types';

export class ApiError extends Error {
  readonly status: number;
  /** The API didn't answer (network error, or the dev proxy with the backend down). */
  readonly unreachable: boolean;

  constructor(status: number, message: string, unreachable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.unreachable = unreachable;
  }
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';
// English fallbacks; the UI shows its own translated text (i18n `errorMessage`).
const UNREACHABLE = "Can't reach the job-radar API. Is the backend running (npm run dev in backend/)?";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal, headers: { Accept: 'application/json' } });
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, UNREACHABLE, true);
  }
  if (!res.ok) {
    let message: string | null = null;
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? null;
    } catch {
      // Non-JSON body: not our API answering (e.g. the dev proxy when the
      // backend is down), so a 5xx most likely means it's unreachable.
    }
    const unreachable = message === null && res.status >= 500;
    throw new ApiError(res.status, message ?? (unreachable ? UNREACHABLE : `Request failed (${res.status})`), unreachable);
  }
  return (await res.json()) as T;
}

export function fetchJobs(query: string, signal?: AbortSignal): Promise<JobsResponse> {
  return getJson<JobsResponse>(`/api/jobs${query ? `?${query}` : ''}`, signal);
}

/** The RSS feed for a search (same query string as fetchJobs). */
export function feedUrl(query: string): string {
  return `${API_BASE}/api/jobs/feed.xml${query ? `?${query}` : ''}`;
}

export function fetchJob(id: string, signal?: AbortSignal): Promise<JobDetail> {
  return getJson<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`, signal);
}

export function fetchStats(signal?: AbortSignal): Promise<Stats> {
  return getJson<Stats>('/api/stats', signal);
}

export function fetchAccuracy(signal?: AbortSignal): Promise<Accuracy> {
  return getJson<Accuracy>('/api/accuracy', signal);
}

/** "Role closed?": asks the API to re-check the role with the employer. */
export function reportClosed(id: string): Promise<ReportResult> {
  return requestJson<ReportResult>(`/api/jobs/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    // JSON on purpose: the API refuses form posts, which other sites could forge.
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
  });
}
