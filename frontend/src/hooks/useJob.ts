import { useEffect, useState } from 'react';
import { ApiError, fetchJob } from '../api/client';
import type { JobDetail } from '../api/types';

export type JobLoadState =
  | { status: 'loading' }
  | { status: 'error'; error: Error; notFound: boolean }
  | { status: 'ready'; job: JobDetail };

/** Loads one job's full detail; `retry` re-runs the request. */
export function useJob(id: string): { state: JobLoadState; retry: () => void } {
  const [result, setResult] = useState<{ id: string; attempt: number; state: JobLoadState } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchJob(id, controller.signal)
      .then((job) => setResult({ id, attempt, state: { status: 'ready', job } }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          id,
          attempt,
          state: {
            status: 'error',
            error: err instanceof Error ? err : new Error(String(err)),
            notFound: err instanceof ApiError && err.status === 404,
          },
        });
      });
    return () => controller.abort();
  }, [id, attempt]);

  // A result for another id/attempt is stale: show loading until ours lands.
  const state: JobLoadState = result && result.id === id && result.attempt === attempt ? result.state : { status: 'loading' };
  return { state, retry: () => setAttempt((a) => a + 1) };
}
