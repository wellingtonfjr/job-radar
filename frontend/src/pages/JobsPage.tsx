import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { feedUrl } from '../api/client';
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

const FEED_TEXT = {
  link: 'RSS',
  label: 'Subscribe to this search (RSS feed)',
  title: 'job-radar: this search',
};

let savedScrollY = 0;

export function JobsPage({ search, stats, lastVisit }: JobsPageProps) {
  const filters = useMemo(() => parseFilters(search), [search]);
  const selectedJob = new URLSearchParams(search).get('job');
  const query = serializeFilters(filters);
  const listing = useJobs(query);
  const feed = feedUrl(query);
  const splitView = useMediaQuery(SPLIT_VIEW_QUERY);
  // The preview pane only takes room once a role is picked; until then the list gets the full width.
  const previewId = splitView ? selectedJob : null;
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

  // Lets browsers and feed readers discover the feed for the current search.
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.type = 'application/rss+xml';
    link.title = FEED_TEXT.title;
    link.href = feed;
    document.head.appendChild(link);
    return () => link.remove();
  }, [feed]);

  const categoryName = (id: string) => stats?.categories.find((c) => c.id === id)?.name ?? id;
  const isNew = (job: Job) => {
    const recentlyPosted = listing.fetchedAt - Date.parse(job.postedAt ?? job.firstSeenAt) < DAY_MS;
    return recentlyPosted || (lastVisit !== null && job.firstSeenAt > lastVisit);
  };
  const activeCount = countActiveFilters(filters);
  const hasQuery = activeCount > 0 || filters.q.trim() !== '';
  // With filters on, "new this week" counts only the matching roles.
  const newThisWeek = hasQuery ? listing.newLast7Days : stats?.totals.newLast7Days;
  const resultLabel = listing.status === 'ready' ? `Show ${formatCount(listing.total)} roles` : 'Show roles';

  const panel = <FilterPanel filters={filters} stats={stats} onChange={applyFilters} />;

  return (
    <div className={`workspace${previewId ? ' workspace--split' : ''}`}>
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
                  {newThisWeek !== undefined && (
                    <>
                      {' · '}
                      <span className="num">{formatCount(newThisWeek)}</span> new this week
                    </>
                  )}
                </>
              ) : listing.status === 'loading' ? (
                'Scanning…'
              ) : null}
            </p>
          </div>
          <div className="results__actions">
            <a className="button button--ghost feed-link" href={feed} aria-label={FEED_TEXT.label} title={FEED_TEXT.label}>
              <Icon name="rss" /> <span className="feed-link__text">{FEED_TEXT.link}</span>
            </a>
            <button type="button" className="button button--ghost filters-toggle" onClick={() => setSheetOpen(true)}>
              <Icon name="filter" /> Filters
              {activeCount > 0 && <span className="count-dot">{activeCount}</span>}
            </button>
          </div>
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
                  selected={job.id === previewId}
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

      {previewId && (
        <aside className="preview" aria-label="Role preview">
          <JobPreview key={previewId} id={previewId} stats={stats} onClose={() => selectJob(null)} />
        </aside>
      )}
    </div>
  );
}
