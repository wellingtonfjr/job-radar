import type { SourceStatus } from '../api/types';
import { useI18n } from '../i18n';

interface SourcesFooterProps {
  sources: SourceStatus[] | undefined;
}

/**
 * Where every role comes from and how fresh each source is, plus the
 * attribution the job boards' terms ask for.
 */
export function SourcesFooter({ sources }: SourcesFooterProps) {
  const { t, fmt } = useI18n();
  return (
    <footer className="footer" id="sources">
      <div className="footer__inner">
        <div className="footer__about">
          <p className="footer__brand">job-radar</p>
          <p>{t.footer.about}</p>
        </div>
        {sources && (
          <table className="sources">
            <caption>{t.footer.sources}</caption>
            <thead>
              <tr>
                <th scope="col">{t.footer.source}</th>
                <th scope="col">{t.footer.type}</th>
                <th scope="col" className="num">
                  {t.footer.open}
                </th>
                <th scope="col">{t.footer.lastScan}</th>
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
                  <td>{t.footer.kind[s.kind]}</td>
                  <td className="num">{fmt.count(s.openJobs)}</td>
                  <td>
                    {s.lastRun ? fmt.relative(s.lastRun.finishedAt ?? s.lastRun.startedAt) : t.footer.never}
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
