import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJobs } from '../api/client';
import type { Job } from '../api/types';

const PAGE_SIZE = 20;

interface JobsState {
  query: string;
  jobs: Job[];
  total: number;
  newLast7Days: number;
  page: number;
  hasMore: boolean;
  status: 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error: string | null;
  // When the latest page arrived; "New" badges compare against this instead of the clock at render time.
  fetchedAt: number;
}

// The last listing, so returning from a job's detail page restores the
// loaded pages instead of starting over at page 1.
let cachedState: JobsState | null = null;

function initialState(query: string): JobsState {
  return { query, jobs: [], total: 0, newLast7Days: 0, page: 0, hasMore: false, status: 'loading', loadingMore: false, error: null, fetchedAt: 0 };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong while loading jobs.';
}

/**
 * Paginated job listing for a filter query string. Changing the query resets
 * the list; `loadMore` appends the next page. In-flight requests for a stale
 * query are aborted so results never arrive out of order.
 */
export function useJobs(filterQuery: string) {
  const [restoredQuery, setRestoredQuery] = useState(() => (cachedState?.query === filterQuery && cachedState.status === 'ready' ? filterQuery : null));
  const [state, setState] = useState<JobsState>(() => (restoredQuery !== null && cachedState ? cachedState : initialState(filterQuery)));
  const [reloadToken, setReloadToken] = useState(0);
  const moreController = useRef<AbortController | null>(null);

  // Reset synchronously when the query changes (no flash of stale results).
  if (state.query !== filterQuery) {
    setState(initialState(filterQuery));
    setRestoredQuery(null);
  }

  useEffect(() => {
    cachedState = state;
  }, [state]);

  useEffect(() => {
    if (restoredQuery === filterQuery) return;
    const controller = new AbortController();
    moreController.current?.abort();
    const params = new URLSearchParams(filterQuery);
    params.set('page', '1');
    params.set('pageSize', String(PAGE_SIZE));

    fetchJobs(params.toString(), controller.signal)
      .then((res) =>
        setState({ query: filterQuery, jobs: res.jobs, total: res.total, newLast7Days: res.newLast7Days, page: 1, hasMore: res.hasMore, status: 'ready', loadingMore: false, error: null, fetchedAt: Date.now() }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ ...initialState(filterQuery), status: 'error', error: errorText(err) });
      });
    return () => controller.abort();
  }, [filterQuery, reloadToken, restoredQuery]);

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.hasMore || state.loadingMore) return;
    const controller = new AbortController();
    moreController.current = controller;
    const params = new URLSearchParams(filterQuery);
    params.set('page', String(state.page + 1));
    params.set('pageSize', String(PAGE_SIZE));
    setState((s) => ({ ...s, loadingMore: true, error: null }));

    fetchJobs(params.toString(), controller.signal)
      .then((res) =>
        setState((s) => {
          if (s.query !== filterQuery) return s;
          // Guard against duplicates if new jobs shifted page boundaries.
          const seen = new Set(s.jobs.map((j) => j.id));
          return { ...s, jobs: [...s.jobs, ...res.jobs.filter((j) => !seen.has(j.id))], total: res.total, newLast7Days: res.newLast7Days, page: res.page, hasMore: res.hasMore, loadingMore: false, fetchedAt: Date.now() };
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, loadingMore: false, error: errorText(err) }));
      });
  }, [filterQuery, state.status, state.hasMore, state.loadingMore, state.page]);

  const retry = useCallback(() => {
    setState(initialState(filterQuery));
    setRestoredQuery(null);
    setReloadToken((t) => t + 1);
  }, [filterQuery]);

  return { ...state, restored: restoredQuery === filterQuery, loadMore, retry };
}
