import type { JobFilters, JobsResponse } from './types';

const API_BASE_URL = 'http://localhost:3001';

export function buildJobsQuery(filters: JobFilters): string {
  const params = new URLSearchParams();
  if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.location.trim()) params.set('location', filters.location.trim());
  if (filters.remoteOnly) params.set('remoteOnly', 'true');
  if (filters.source) params.set('source', filters.source);
  return params.toString();
}

export async function fetchJobs(
  filters: JobFilters,
  signal?: AbortSignal,
): Promise<JobsResponse> {
  const query = buildJobsQuery(filters);
  const url = `${API_BASE_URL}/api/jobs${query ? `?${query}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(
      'Could not reach the job-radar API. Is the backend running on http://localhost:3001?',
    );
  }

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as JobsResponse;
}
