import type { SourceStatus } from '../api/types';
import { formatCount, formatRelative } from '../lib/format';

interface SourcesFooterProps {
  sources: SourceStatus[] | undefined;
}

/**
 * Transparency about where the jobs come from and how fresh each source is,
 * plus the attribution the aggregators' terms ask for.
 */
export function SourcesFooter({ sources }: SourcesFooterProps) {
  return (
    <footer className="site-footer" id="sources">
      <div className="container">
        <h2 className="site-footer__title">Where these jobs come from</h2>
        <p className="site-footer__lead">
          Employer career pages (Greenhouse, Lever and Ashby job boards) are read directly, so a job disappears as soon as the
          company takes it down. Public job boards fill in the rest; their listings link back to the original posting.
        </p>
        {sources && (
          <ul className="source-list">
            {sources.map((s) => (
              <li key={s.id} className="source">
                <span className={`source__dot source__dot--${s.lastRun?.status ?? 'never'}`} aria-hidden="true" />
                <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="source__name">
                  {s.name}
                </a>
                <span className="source__kind">{s.kind === 'ats' ? 'Employer career pages' : 'Job board'}</span>
                <span className="source__meta">
                  {formatCount(s.openJobs)} open · {s.lastRun ? `checked ${formatRelative(s.lastRun.finishedAt ?? s.lastRun.startedAt)}` : 'not fetched yet'}
                  {s.lastRun && s.lastRun.status !== 'ok' && ` · ${s.lastRun.status}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="site-footer__fine">job-radar is a personal aggregator. Always apply on the original posting.</p>
      </div>
    </footer>
  );
}
