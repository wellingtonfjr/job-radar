import type { JobDetail, Stats } from '../api/types';
import { countryName, formatDate, formatRelative, formatSalary } from '../lib/format';
import { EMPLOYMENT_TYPE_LABELS, PAY_BAND_LABELS, PAY_BAND_RANGES, SENIORITY_LABELS, WORKPLACE_LABELS } from '../lib/labels';
import { jobPath } from '../lib/router';
import { CompanyLogo } from './CompanyLogo';
import { Icon } from './Icon';
import { Link } from './Link';

interface JobDetailViewProps {
  job: JobDetail;
  stats: Stats | null;
  /** `pane`: compact header with "open full page" and close actions. */
  variant: 'page' | 'pane';
  onClose?: () => void;
}

const ATS_SOURCES = new Set(['greenhouse', 'lever', 'ashby']);

function eligibility(job: JobDetail): string | null {
  if (job.allowedCountries === null) return job.workplace === 'remote' ? 'Anywhere (no restriction found)' : null;
  const names = job.allowedCountries.map(countryName);
  return names.length > 6 ? `${names.slice(0, 6).join(', ')} +${names.length - 6} more` : names.join(', ');
}

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

export function JobDetailView({ job, stats, variant, onClose }: JobDetailViewProps) {
  const categoryName = stats?.categories.find((c) => c.id === job.category)?.name ?? job.category;
  const salary = formatSalary(job.salary);
  const posted = formatDate(job.postedAt) ?? formatDate(job.firstSeenAt);
  const fromAts = ATS_SOURCES.has(job.source);

  const facts: [string, string | null][] = [
    ['Salary', salary],
    ['Work mode', WORKPLACE_LABELS[job.workplace]],
    ['Can work from', eligibility(job)],
    ['Location', job.locations.join(' · ') || null],
    ['Level', job.seniority ? SENIORITY_LABELS[job.seniority] : null],
    ['Type', job.employmentType ? EMPLOYMENT_TYPE_LABELS[job.employmentType] : null],
    ['Category', categoryName],
    ['Pay band', job.companyTier ? `${PAY_BAND_LABELS[job.companyTier]} (${PAY_BAND_RANGES[job.companyTier]})` : null],
    ['Posted', posted],
  ];
  const TitleTag = variant === 'page' ? 'h1' : 'h2';

  return (
    <article className={`job-detail job-detail--${variant}`} aria-label={`${job.title} at ${job.company}`}>
      {variant === 'pane' && (
        <div className="job-detail__toolbar">
          <Link href={jobPath(job.id)} className="link-button">
            Open full page
          </Link>
          {onClose && (
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close preview">
              <Icon name="close" />
            </button>
          )}
        </div>
      )}

      {job.closedAt && (
        <div className="notice" role="status">
          Removed by its source {formatRelative(job.closedAt)}. It's probably filled.
        </div>
      )}

      <header className="job-detail__header">
        <CompanyLogo name={job.company} src={job.companyLogo} size="lg" />
        <div>
          <p className="job-detail__company">{job.company}</p>
          <TitleTag className="job-detail__title">{job.title}</TitleTag>
        </div>
      </header>

      <div className="job-detail__apply">
        {!job.closedAt && (
          <a className="button button--primary" href={job.url} target="_blank" rel="noopener noreferrer">
            {fromAts ? 'Apply on company site' : `Apply via ${job.sourceName}`}
            <Icon name="external" size={16} />
          </a>
        )}
        <p className="verified">
          <span className="live__dot" aria-hidden="true" />
          Verified open {formatRelative(job.lastSeenAt)} · {fromAts ? `${job.sourceName} (company ATS)` : job.sourceName}
        </p>
      </div>

      <dl className="facts">
        {facts
          .filter((f): f is [string, string] => Boolean(f[1]))
          .map(([label, value]) => (
            <div key={label} className="facts__item">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      {job.skills.length > 0 && (
        <ul className="job-card__chips job-detail__skills" aria-label="Stack">
          {job.skills.map((s) => (
            <li key={s} className="skill">
              {s}
            </li>
          ))}
        </ul>
      )}

      <section className="job-detail__description" aria-label="Description">
        {job.description ? <Description text={job.description} /> : <p className="muted">No description from the source. See the original posting.</p>}
      </section>

      {job.alsoOn.length > 0 && (
        <p className="also-on">
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
    </article>
  );
}
