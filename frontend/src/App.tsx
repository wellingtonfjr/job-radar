import { useEffect, useRef, useState } from 'react';
import { Link } from './components/Link';
import { SourcesFooter } from './components/SourcesFooter';
import { StatusMessage } from './components/StatusMessage';
import { TopBar } from './components/TopBar';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useStats } from './hooks/useStats';
import { listUrl, parseFilters } from './lib/filters';
import { takeLastVisit } from './lib/lastVisit';
import { matchRoute, navigate, useLocation } from './lib/router';
import { JobDetailPage } from './pages/JobDetailPage';
import { JobsPage } from './pages/JobsPage';
import { SavedPage } from './pages/SavedPage';

const SEARCH_DEBOUNCE_MS = 350;

export default function App() {
  const { pathname, search } = useLocation();
  const route = matchRoute(pathname);
  const stats = useStats();
  // Read once per page load: "New" means first seen since the previous visit.
  const [lastVisit] = useState(takeLastVisit);

  // The search box lives in the top bar on every page. On the list it
  // filters as you type; elsewhere it searches on submit.
  const urlQuery = route.name === 'jobs' ? parseFilters(search).q : '';
  const [searchInput, setSearchInput] = useState(urlQuery);
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery);
    if (urlQuery.trim() !== searchInput.trim()) setSearchInput(urlQuery);
  }

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const latest = useRef({ route, search });
  latest.current = { route, search };
  useEffect(() => {
    const { route: current, search: currentSearch } = latest.current;
    if (current.name !== 'jobs') return;
    const filters = parseFilters(currentSearch);
    if (debouncedSearch.trim() === filters.q.trim()) return;
    navigate(listUrl({ ...filters, q: debouncedSearch }, new URLSearchParams(currentSearch).get('job')), { replace: true });
  }, [debouncedSearch]);

  const submitSearch = () => {
    const filters = route.name === 'jobs' ? parseFilters(search) : parseFilters('');
    navigate(listUrl({ ...filters, q: searchInput }), { replace: route.name === 'jobs' });
  };

  // "/" focuses the search, like most search-first tools.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== '/' || target.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      document.querySelector<HTMLInputElement>('.search input')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to results
      </a>
      <TopBar
        lastUpdatedAt={stats?.lastUpdatedAt}
        search={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={submitSearch}
      />
      {route.name === 'jobs' && <JobsPage search={search} stats={stats} lastVisit={lastVisit} />}
      {route.name === 'job' && <JobDetailPage key={route.id} id={route.id} stats={stats} />}
      {route.name === 'saved' && <SavedPage />}
      {route.name === 'not-found' && (
        <main className="page" id="main">
          <StatusMessage title="Page not found">
            <Link href="/">Browse open roles</Link>
          </StatusMessage>
        </main>
      )}
      <SourcesFooter sources={stats?.sources} />
    </>
  );
}
