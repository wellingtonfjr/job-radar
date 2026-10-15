import { useState } from 'react';
import { Link } from './components/Link';
import { SiteHeader } from './components/SiteHeader';
import { SourcesFooter } from './components/SourcesFooter';
import { StatusMessage } from './components/StatusMessage';
import { useStats } from './hooks/useStats';
import { takeLastVisit } from './lib/lastVisit';
import { matchRoute, useLocation } from './lib/router';
import { JobDetailPage } from './pages/JobDetailPage';
import { JobsPage } from './pages/JobsPage';

export default function App() {
  const { pathname, search } = useLocation();
  const route = matchRoute(pathname);
  const stats = useStats();
  // Read once per page load: "New" means first seen since the previous visit.
  const [lastVisit] = useState(takeLastVisit);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to results
      </a>
      <SiteHeader lastUpdatedAt={stats?.lastUpdatedAt} />
      {route.name === 'jobs' && <JobsPage search={search} stats={stats} lastVisit={lastVisit} />}
      {route.name === 'job' && <JobDetailPage key={route.id} id={route.id} stats={stats} />}
      {route.name === 'not-found' && (
        <main className="container detail">
          <StatusMessage title="Page not found">
            <Link href="/">Browse open jobs</Link>
          </StatusMessage>
        </main>
      )}
      <SourcesFooter sources={stats?.sources} />
    </>
  );
}
