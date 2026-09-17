import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { fetchJobs } from './api';
import { FilterPanel } from './components/FilterPanel';
import { JobCard } from './components/JobCard';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import type { Job } from './types';
import { getLastVisit, setLastVisitNow } from './utils/lastVisit';
import { readFiltersFromUrl, writeFiltersToUrl } from './utils/urlFilters';

const DEBOUNCE_MS = 350;

function App() {
  const initialFilters = useMemo(() => readFiltersFromUrl(), []);

  const [keywordInput, setKeywordInput] = useState(initialFilters.keyword);
  const [locationInput, setLocationInput] = useState(initialFilters.location);
  const [remoteOnly, setRemoteOnly] = useState(initialFilters.remoteOnly);
  const [source, setSource] = useState(initialFilters.source);
  const [baseCountries, setBaseCountries] = useState(initialFilters.baseCountries);

  const debouncedKeyword = useDebouncedValue(keywordInput, DEBOUNCE_MS);
  const debouncedLocation = useDebouncedValue(locationInput, DEBOUNCE_MS);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Snapshot the previous visit's timestamp once, then immediately stamp "now"
  // so badges naturally clear on the next visit/reload. Guarded so this only
  // ever runs once even under StrictMode's double-invoked mount effects.
  const lastVisitRef = useRef<string | null>(null);
  const hasCapturedLastVisit = useRef(false);
  const [lastVisitReady, setLastVisitReady] = useState(false);
  useEffect(() => {
    if (hasCapturedLastVisit.current) return;
    hasCapturedLastVisit.current = true;
    lastVisitRef.current = getLastVisit();
    setLastVisitNow();
    setLastVisitReady(true);
  }, []);

  const activeFilters = useMemo(
    () => ({
      keyword: debouncedKeyword,
      location: debouncedLocation,
      remoteOnly,
      source,
      baseCountries,
    }),
    [debouncedKeyword, debouncedLocation, remoteOnly, source, baseCountries],
  );

  useEffect(() => {
    writeFiltersToUrl(activeFilters);

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchJobs(activeFilters, controller.signal)
      .then((res) => {
        setJobs(res.jobs);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setJobs([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Something went wrong while loading jobs.');
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [activeFilters]);

  const isNewJob = (job: Job): boolean => {
    if (!lastVisitReady || !lastVisitRef.current) return false;
    return new Date(job.firstSeenAt).getTime() > new Date(lastVisitRef.current).getTime();
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>job-radar</h1>
        <p className="app-subtitle">
          Open roles aggregated from Greenhouse, Lever, Remotive and Arbeitnow.
        </p>
      </header>

      <FilterPanel
        keyword={keywordInput}
        onKeywordChange={setKeywordInput}
        location={locationInput}
        onLocationChange={setLocationInput}
        remoteOnly={remoteOnly}
        onRemoteOnlyChange={setRemoteOnly}
        source={source}
        onSourceChange={setSource}
        baseCountries={baseCountries}
        onBaseCountriesChange={setBaseCountries}
      />

      <main className="job-results">
        {loading && <div className="state-message">Loading jobs...</div>}

        {!loading && error && (
          <div className="state-message state-error">
            <strong>Couldn't load jobs.</strong>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div className="state-message">No jobs match your filters.</div>
        )}

        {!loading && !error && jobs.length > 0 && (
          <>
            <div className="results-summary">
              Showing {jobs.length} of {total} job{total === 1 ? '' : 's'}
            </div>
            <div className="job-grid">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} isNew={isNewJob(job)} />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        <span>Data from public job-board APIs, refreshed by the job-radar backend.</span>
      </footer>
    </div>
  );
}

export default App;
