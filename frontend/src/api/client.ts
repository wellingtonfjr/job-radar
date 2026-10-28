import type { JobDetail, JobsResponse, Stats } from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const UNREACHABLE = "Can't reach the job-radar API. Is the backend running (npm run dev in backend/)?";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, UNREACHABLE);
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
    throw new ApiError(res.status, message ?? (res.status >= 500 ? UNREACHABLE : `Request failed (${res.status})`));
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
