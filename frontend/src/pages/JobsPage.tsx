import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { Job, Stats } from '../api/types';
import { ActiveFilters } from '../components/ActiveFilters';
import { FilterPanel } from '../components/FilterPanel';
import { FilterSheet } from '../components/FilterSheet';
import { Icon } from '../components/Icon';
import { JobPreview } from '../components/JobPreview';
import { JobRow, JobRowSkeleton } from '../components/JobRow';
import { StatusMessage } from '../components/StatusMessage';
import { useJobs } from '../hooks/useJobs';
import { SPLIT_VIEW_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { countActiveFilters, EMPTY_FILTERS, listUrl, parseFilters, serializeFilters, type Filters } from '../lib/filters';
import { formatCount } from '../lib/format';
import { navigate } from '../lib/router';

interface JobsPageProps {
  search: string;
  stats: Stats | null;
  lastVisit: string | null;
}

const DAY_MS = 86_400_000;

let savedScrollY = 0;

export function JobsPage({ search, stats, lastVisit }: JobsPageProps) {
  const filters = useMemo(() => parseFilters(search), [search]);
  const selectedJob = new URLSearchParams(search).get('job');
  const listing = useJobs(serializeFilters(filters));
  const splitView = useMediaQuery(SPLIT_VIEW_QUERY);
  const [sheetOpen, setSheetOpen] = useState(false);

  const applyFilters = (next: Filters) => navigate(listUrl(next, selectedJob), { replace: true });
  const selectJob = (id: string | null) => navigate(listUrl(filters, id), { replace: true });

  useLayoutEffect(() => {
    if (listing.restored) window.scrollTo(0, savedScrollY);
    // Only on mount: restoring later would fight the user's scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = 'job-radar · Open roles, verified daily';
  }, []);

  const categoryName = (id: string) => stats?.categories.find((c) => c.id === id)?.name ?? id;
  const isNew = (job: Job) => {
    const recentlyPosted = Date.now() - Date.parse(job.postedAt ?? job.firstSeenAt) < DAY_MS;
    return recentlyPosted || (lastVisit !== null && job.firstSeenAt > lastVisit);
  };
  const activeCount = countActiveFilters(filters);
  const hasQuery = activeCount > 0 || filters.q.trim() !== '';
  const resultLabel = listing.status === 'ready' ? `Show ${formatCount(listing.total)} roles` : 'Show roles';

  const panel = <FilterPanel filters={filters} stats={stats} onChange={applyFilters} />;

  return (
    <div className={`workspace${splitView ? ' workspace--split' : ''}`}>
      <aside className="sidebar" aria-label="Filters">
        {panel}
      </aside>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} resultLabel={resultLabel}>
        {panel}
      </FilterSheet>

      <main className="results" id="main">
        <div className="results__header">
          <div>
            <h1 className="results__title">Open roles</h1>
            <p className="results__summary" aria-live="polite">
              {listing.status === 'ready' ? (
                <>
                  <span className="num">{formatCount(listing.total)}</span> {hasQuery ? 'matching' : 'verified open'}
                  {stats && (
                    <>
                      {' · '}
                      <span className="num">{formatCount(stats.totals.newLast7Days)}</span> new this week
                    </>
                  )}
                </>
              ) : listing.status === 'loading' ? (
                'Scanning…'
              ) : null}
            </p>
          </div>
          <button type="button" className="button button--ghost filters-toggle" onClick={() => setSheetOpen(true)}>
            <Icon name="filter" /> Filters
            {activeCount > 0 && <span className="count-dot">{activeCount}</span>}
          </button>
        </div>

        <ActiveFilters filters={filters} stats={stats} onChange={applyFilters} />

        {listing.status === 'loading' && (
          <div className="job-list" aria-busy="true" aria-label="Loading roles">
            {Array.from({ length: 6 }, (_, i) => (
              <JobRowSkeleton key={i} />
            ))}
          </div>
        )}

        {listing.status === 'error' && (
          <StatusMessage title="Couldn't load roles" tone="error" action={{ label: 'Try again', onClick: listing.retry }}>
            {listing.error}
          </StatusMessage>
        )}

        {listing.status === 'ready' && listing.jobs.length === 0 && (
          <StatusMessage
            title="Nothing on the radar for this search"
            action={hasQuery ? { label: 'Clear search and filters', onClick: () => applyFilters(EMPTY_FILTERS) } : undefined}
          >
            {hasQuery ? 'Try fewer filters or a broader term.' : 'No roles ingested yet. Run npm run ingest in backend/.'}
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
                  selected={splitView && job.id === selectedJob}
                  onSelect={splitView ? () => selectJob(job.id) : undefined}
                  onOpen={() => {
                    savedScrollY = window.scrollY;
                  }}
                />
              ))}
            </div>
            <div className="results__more">
              {listing.error && (
                <p className="results__more-error" role="alert">
                  {listing.error}
                </p>
              )}
              {listing.hasMore ? (
                <button type="button" className="button button--ghost" onClick={listing.loadMore} disabled={listing.loadingMore}>
                  {listing.loadingMore ? 'Loading…' : `Load more · ${formatCount(listing.total - listing.jobs.length)} left`}
                </button>
              ) : (
                <p className="results__end">That's all {formatCount(listing.total)}.</p>
              )}
            </div>
          </>
        )}
      </main>

      {splitView && (
        <aside className="preview" aria-label="Role preview">
          <JobPreview id={selectedJob} stats={stats} onClose={() => selectJob(null)} />
        </aside>
      )}
    </div>
  );
}
