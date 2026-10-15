import { useEffect, useState } from 'react';
import { ApiError, fetchJob } from '../api/client';
import type { JobDetail, Stats } from '../api/types';
import { CompanyLogo } from '../components/CompanyLogo';
import { Link } from '../components/Link';
import { StatusMessage } from '../components/StatusMessage';
import { countryName, formatDate, formatRelative, formatSalary } from '../lib/format';
import { EMPLOYMENT_TYPE_LABELS, SENIORITY_LABELS, TIER_LABELS, WORKPLACE_LABELS } from '../lib/labels';

interface JobDetailPageProps {
  id: string;
  stats: Stats | null;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string; notFound: boolean } | { status: 'ready'; job: JobDetail };

/** Splits the stored plain-text description into paragraphs. */
function Description({ text }: { text: string }) {
  return (
    <div className="description">
      {text.split(/\n{2,}/).map((block, i) => (
        <p key={i}>{block}</p>
      ))}
    </div>
  );
}

function eligibility(job: JobDetail): string {
  if (job.allowedCountries === null) return job.workplace === 'remote' ? 'Open to candidates anywhere (no restriction detected)' : 'See the posting';
  const names = job.allowedCountries.map(countryName);
  return names.length > 8 ? `${names.slice(0, 8).join(', ')} +${names.length - 8} more` : names.join(', ');
}

export function JobDetailPage({ id, stats }: JobDetailPageProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchJob(id, controller.signal)
      .then((job) => setState({ status: 'ready', job }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Something went wrong.',
          notFound: err instanceof ApiError && err.status === 404,
        });
      });
    return () => controller.abort();
  }, [id, attempt]);

  useEffect(() => {
    if (state.status === 'ready') document.title = `${state.job.title} at ${state.job.company} · job-radar`;
  }, [state]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (state.status === 'loading') {
    return (
      <main className="container detail" aria-busy="true">
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--block" />
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="container detail">
        <StatusMessage
          title={state.notFound ? 'This job is no longer listed' : "Couldn't load this job"}
          tone={state.notFound ? 'neutral' : 'error'}
          action={state.notFound ? undefined : { label: 'Try again', onClick: () => setAttempt((a) => a + 1) }}
        >
          {state.notFound ? <Link href="/">Browse open jobs</Link> : state.message}
        </StatusMessage>
      </main>
    );
  }

  const { job } = state;
  const categoryName = stats?.categories.find((c) => c.id === job.category)?.name ?? job.category;
  const salary = formatSalary(job.salary);
  const posted = formatDate(job.postedAt) ?? formatDate(job.firstSeenAt);
  const applyLabel = job.source === 'greenhouse' || job.source === 'lever' || job.source === 'ashby' ? 'Apply on company site' : `Apply via ${job.sourceName}`;

  const facts: [string, string | null][] = [
    ['Category', categoryName],
    ['Salary', salary],
    ['Work mode', WORKPLACE_LABELS[job.workplace]],
    ['Can work from', eligibility(job)],
    ['Location', job.locations.join(' · ') || null],
    ['Employment type', job.employmentType ? EMPLOYMENT_TYPE_LABELS[job.employmentType] : null],
    ['Career level', job.seniority ? SENIORITY_LABELS[job.seniority] : null],
    ['Company tier', job.companyTier ? TIER_LABELS[job.companyTier] : null],
    ['Posted', posted],
  ];

  return (
    <main className="container detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">All jobs</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/?category=${encodeURIComponent(job.category)}`}>{categoryName}</Link>
      </nav>

      {job.closedAt && (
        <div className="notice notice--closed" role="status">
          This job was removed by its source {formatRelative(job.closedAt)} and is probably filled.
        </div>
      )}

      <div className="detail__layout">
        <header className="detail__header">
          <h1 className="detail__title">{job.title}</h1>
          <p className="detail__subtitle">
            <strong>{job.company}</strong>
            {posted && <> · posted {posted}</>}
            {' · '}via {job.sourceName}
          </p>
          {job.skills.length > 0 && (
            <ul className="tags detail__skills" aria-label="Technologies">
              {job.skills.map((s) => (
                <li key={s} className="tag tag--skill">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </header>

        <article className="detail__body" aria-label="Job description">
          {job.description ? <Description text={job.description} /> : <p className="muted">The source didn’t provide a description. See the original posting.</p>}
        </article>

        <aside className="detail__aside" aria-label="Job summary">
          <div className="summary-card">
            <div className="summary-card__company">
              <CompanyLogo name={job.company} src={job.companyLogo} size="lg" />
              <span className="summary-card__name">{job.company}</span>
            </div>
            <dl className="facts">
              {facts
                .filter((f): f is [string, string] => Boolean(f[1]))
                .map(([label, value]) => (
                  <div key={label} className="facts__row">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            {!job.closedAt && (
              <a className="button button--primary button--block" href={job.url} target="_blank" rel="noopener noreferrer">
                {applyLabel} <span aria-hidden="true">→</span>
              </a>
            )}
            <p className="summary-card__verified">
              <span className="freshness__dot" aria-hidden="true" /> Last confirmed open {formatRelative(job.lastSeenAt)}
            </p>
            {job.alsoOn.length > 0 && (
              <p className="summary-card__also">
                Also listed on{' '}
                {job.alsoOn.map((d, i) => (
                  <span key={`${d.source}-${i}`}>
                    {i > 0 && ', '}
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.sourceName}
                    </a>
                  </span>
                ))}
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
