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
import { errorMessage, useI18n } from '../i18n';
import { countActiveFilters, EMPTY_FILTERS, listUrl, parseFilters, serializeFilters, type Filters } from '../lib/filters';
import { navigate } from '../lib/router';

interface JobsPageProps {
  search: string;
  stats: Stats | null;
  lastVisit: string | null;
}

const DAY_MS = 86_400_000;

let savedScrollY = 0;

export function JobsPage({ search, stats, lastVisit }: JobsPageProps) {
  const { t, fmt } = useI18n();
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
    document.title = t.results.pageTitle;
  }, [t]);

  // Lets browsers and feed readers discover the feed for the current search.
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.type = 'application/rss+xml';
    link.title = t.results.feedTitle;
    link.href = feed;
    document.head.appendChild(link);
    return () => link.remove();
  }, [feed, t]);

  const categoryName = (id: string) => fmt.category(id, stats?.categories.find((c) => c.id === id)?.name);
  const isNew = (job: Job) => {
    const recentlyPosted = listing.fetchedAt - Date.parse(job.postedAt ?? job.firstSeenAt) < DAY_MS;
    return recentlyPosted || (lastVisit !== null && job.firstSeenAt > lastVisit);
  };
  const activeCount = countActiveFilters(filters);
  const hasQuery = activeCount > 0 || filters.q.trim() !== '';
  // With filters on, "new this week" counts only the matching roles.
  const newThisWeek = hasQuery ? listing.newLast7Days : stats?.totals.newLast7Days;
  const resultLabel = t.results.showRoles(listing.status === 'ready' ? listing.total : null);

  const panel = <FilterPanel filters={filters} stats={stats} onChange={applyFilters} />;

  return (
    <div className={`workspace${previewId ? ' workspace--split' : ''}`}>
      <aside className="sidebar" aria-label={t.filters.title}>
        {panel}
      </aside>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} resultLabel={resultLabel}>
        {panel}
      </FilterSheet>

      <main className="results" id="main">
        <div className="results__header">
          <div>
            <h1 className="results__title">{t.results.title}</h1>
            <p className="results__summary" aria-live="polite">
              {listing.status === 'ready' ? (
                <>
                  <span className="num">{fmt.count(listing.total)}</span>{' '}
                  {fmt.plural(hasQuery ? t.results.matching : t.results.verifiedOpen, listing.total)}
                  {newThisWeek !== undefined && (
                    <>
                      {' · '}
                      <span className="num">{fmt.count(newThisWeek)}</span> {fmt.plural(t.results.newThisWeek, newThisWeek)}
                    </>
                  )}
                </>
              ) : listing.status === 'loading' ? (
                t.results.scanning
              ) : null}
            </p>
          </div>
          <div className="results__actions">
            <a className="button button--ghost feed-link" href={feed} aria-label={t.results.feedLabel} title={t.results.feedLabel}>
              <Icon name="rss" /> <span className="feed-link__text">{t.results.feedLink}</span>
            </a>
            <button type="button" className="button button--ghost filters-toggle" onClick={() => setSheetOpen(true)}>
              <Icon name="filter" /> {t.filters.title}
              {activeCount > 0 && <span className="count-dot">{activeCount}</span>}
            </button>
          </div>
        </div>

        <ActiveFilters filters={filters} stats={stats} onChange={applyFilters} />

        {listing.status === 'loading' && (
          <div className="job-list" aria-busy="true" aria-label={t.results.loadingRoles}>
            {Array.from({ length: 6 }, (_, i) => (
              <JobRowSkeleton key={i} />
            ))}
          </div>
        )}

        {listing.status === 'error' && (
          <StatusMessage title={t.results.loadError} tone="error" action={{ label: t.app.tryAgain, onClick: listing.retry }}>
            {errorMessage(listing.error, t)}
          </StatusMessage>
        )}

        {listing.status === 'ready' && listing.jobs.length === 0 && (
          <StatusMessage
            title={t.results.emptyTitle}
            action={hasQuery ? { label: t.results.emptyClear, onClick: () => applyFilters(EMPTY_FILTERS) } : undefined}
          >
            {hasQuery ? t.results.emptyHint : t.results.noData}
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
                  {errorMessage(listing.error, t)}
                </p>
              )}
              {listing.hasMore ? (
                <button type="button" className="button button--ghost" onClick={listing.loadMore} disabled={listing.loadingMore}>
                  {listing.loadingMore ? t.results.loading : t.results.loadMore(listing.total - listing.jobs.length)}
                </button>
              ) : (
                <p className="results__end">{t.results.end(listing.total)}</p>
              )}
            </div>
          </>
        )}
      </main>

      {previewId && (
        <aside className="preview" aria-label={t.results.preview}>
          <JobPreview key={previewId} id={previewId} stats={stats} onClose={() => selectJob(null)} />
        </aside>
      )}
    </div>
  );
}
