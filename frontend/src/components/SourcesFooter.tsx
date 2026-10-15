import type { SourceStatus } from '../api/types';
import { formatCount, formatRelative } from '../lib/format';

interface SourcesFooterProps {
  sources: SourceStatus[] | undefined;
}

/**
 * Where every role comes from and how fresh each source is, plus the
 * attribution the job boards' terms ask for.
 */
export function SourcesFooter({ sources }: SourcesFooterProps) {
  return (
    <footer className="footer" id="sources">
      <div className="footer__inner">
        <div className="footer__about">
          <p className="footer__brand">job-radar</p>
          <p>
            Company career pages (Greenhouse, Lever and Ashby boards) are scanned directly, so a role disappears as soon as the company
            takes it down. Public job boards fill the gaps and always link back to the original posting.
          </p>
        </div>
        {sources && (
          <table className="sources">
            <caption>Sources</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">
                  Open
                </th>
                <th scope="col">Last scan</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <th scope="row">
                    <span className={`status status--${s.lastRun?.status ?? 'never'}`} aria-hidden="true" />
                    <a href={s.homepage} target="_blank" rel="noopener noreferrer">
                      {s.name}
                    </a>
                  </th>
                  <td>{s.kind === 'ats' ? 'Company ATS' : 'Job board'}</td>
                  <td className="num">{formatCount(s.openJobs)}</td>
                  <td>
                    {s.lastRun ? formatRelative(s.lastRun.finishedAt ?? s.lastRun.startedAt) : 'never'}
                    {s.lastRun && s.lastRun.status !== 'ok' && ` (${s.lastRun.status})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </footer>
  );
}
