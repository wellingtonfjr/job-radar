import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Job, Stats } from '../api/types';
import { CategoryChips } from '../components/CategoryChips';
import { FilterBar } from '../components/FilterBar';
import { JobRow, JobRowSkeleton } from '../components/JobRow';
import { StatusMessage } from '../components/StatusMessage';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useJobs } from '../hooks/useJobs';
import { countActiveFilters, EMPTY_FILTERS, parseFilters, serializeFilters, type Filters } from '../lib/filters';
import { formatCount } from '../lib/format';
import { navigate } from '../lib/router';

interface JobsPageProps {
  search: string;
  stats: Stats | null;
  lastVisit: string | null;
}

const SEARCH_DEBOUNCE_MS = 350;
const DAY_MS = 86_400_000;

let savedScrollY = 0;

/** Filters live in the URL; replacing it re-renders the page with them. */
function applyFilters(next: Filters): void {
  const query = serializeFilters(next);
  navigate(query ? `/?${query}` : '/', { replace: true });
}

export function JobsPage({ search, stats, lastVisit }: JobsPageProps) {
  const filters = useMemo(() => parseFilters(search), [search]);
  const filterQuery = serializeFilters(filters);
  const listing = useJobs(filterQuery);

  const [searchInput, setSearchInput] = useState(filters.q);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  // Typing updates the URL (and so the results) once the user pauses.
  const latestFilters = useRef(filters);
  latestFilters.current = filters;
  useEffect(() => {
    if (debouncedSearch.trim() !== latestFilters.current.q.trim()) applyFilters({ ...latestFilters.current, q: debouncedSearch });
  }, [debouncedSearch]);

  // Keep the input in sync when the URL changes from elsewhere (back/forward, clear).
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    if (filters.q.trim() !== searchInput.trim()) setSearchInput(filters.q);
  }

  useLayoutEffect(() => {
    if (listing.restored) window.scrollTo(0, savedScrollY);
    // Only on mount: restoring later would fight the user's scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = 'job-radar · Real jobs, straight from the source';
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    applyFilters({ ...filters, q: searchInput });
  };

  const categoryName = (id: string) => stats?.categories.find((c) => c.id === id)?.name ?? id;
  const isNew = (job: Job) => {
    const posted = Date.parse(job.postedAt ?? job.firstSeenAt);
    const recentlyPosted = Date.now() - posted < DAY_MS;
    const newSinceVisit = lastVisit !== null && job.firstSeenAt > lastVisit;
    return recentlyPosted || newSinceVisit;
  };
  const hasFilters = countActiveFilters(filters) > 0 || filters.q.trim() !== '';

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 className="hero__title">
            Real jobs, <span className="hero__accent">straight from the source</span>
          </h1>
          <p className="hero__subtitle">
            {stats ? (
              <>
                {formatCount(stats.totals.openJobs)} open jobs from {formatCount(stats.totals.companies)} companies,
                read directly from career pages and public job boards. Closed jobs disappear automatically.
              </>
            ) : (
              'Open jobs read directly from career pages and public job boards. Closed jobs disappear automatically.'
            )}
          </p>

          <form className="search" role="search" onSubmit={onSubmit}>
            <span className="search__icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              className="search__input"
              placeholder="Search job title, company or technology…"
              aria-label="Search jobs"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="button button--primary search__submit">
              Search
            </button>
          </form>

          <FilterBar filters={filters} stats={stats} onChange={applyFilters} />
          {stats && <CategoryChips categories={stats.categories} selected={filters.category} onChange={(category) => applyFilters({ ...filters, category })} />}
        </div>
      </section>

      <main className="container results" id="main">
        <div className="results__meta" aria-live="polite">
          <span>
            {listing.status === 'ready' && (
              <>
                <strong className="results__count">{formatCount(listing.total)}</strong> matching jobs
              </>
            )}
            {listing.status === 'loading' && 'Searching…'}
          </span>
          {stats && (
            <span>
              <strong>{formatCount(stats.totals.newLast7Days)}</strong> added this week
            </span>
          )}
        </div>

        {listing.status === 'loading' && (
          <div className="job-list" aria-busy="true" aria-label="Loading jobs">
            {Array.from({ length: 6 }, (_, i) => (
              <JobRowSkeleton key={i} />
            ))}
          </div>
        )}

        {listing.status === 'error' && (
          <StatusMessage title="Couldn't load jobs" tone="error" action={{ label: 'Try again', onClick: listing.retry }}>
            {listing.error}
          </StatusMessage>
        )}

        {listing.status === 'ready' && listing.jobs.length === 0 && (
          <StatusMessage
            title="No jobs match these filters"
            action={hasFilters ? { label: 'Clear search and filters', onClick: () => applyFilters(EMPTY_FILTERS) } : undefined}
          >
            {hasFilters ? 'Try removing a filter or searching for a broader term.' : 'No jobs have been ingested yet. Run npm run ingest in backend/.'}
          </StatusMessage>
        )}

        {listing.status === 'ready' && listing.jobs.length > 0 && (
          <>
            <div className="job-list">
              {listing.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  categoryName={categoryName(job.category)}
                  isNew={isNew(job)}
                  onOpen={() => {
                    savedScrollY = window.scrollY;
                  }}
                />
              ))}
            </div>
            <div className="results__more">
              {listing.error && <p className="results__more-error" role="alert">{listing.error}</p>}
              {listing.hasMore ? (
                <button type="button" className="button button--primary" onClick={listing.loadMore} disabled={listing.loadingMore}>
                  {listing.loadingMore ? 'Loading…' : 'More jobs'}
                </button>
              ) : (
                <p className="results__end">You’ve seen all {formatCount(listing.total)} jobs.</p>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
