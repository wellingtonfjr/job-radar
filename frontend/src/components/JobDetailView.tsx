import type { JobDetail, Stats } from '../api/types';
import { rich, useI18n, type I18n } from '../i18n';
import { jobPath } from '../lib/router';
import { CompanyLogo } from './CompanyLogo';
import { Icon } from './Icon';
import { Link } from './Link';
import { ReportClosedButton } from './ReportClosedButton';
import { RoleMarkButtons } from './RoleMarkButtons';

interface JobDetailViewProps {
  job: JobDetail;
  stats: Stats | null;
  /** `pane`: compact header with "open full page" and close actions. */
  variant: 'page' | 'pane';
  onClose?: () => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function eligibility(job: JobDetail, { t, fmt }: I18n): string | null {
  if (job.allowedCountries === null) return job.workplace === 'remote' ? t.role.anywhere : null;
  const names = job.allowedCountries.map(fmt.country);
  return names.length > 6 ? `${names.slice(0, 6).join(', ')} ${t.role.moreCountries(names.length - 6)}` : names.join(', ');
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
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const categoryName = fmt.category(job.category, stats?.categories.find((c) => c.id === job.category)?.name);
  const salary = fmt.salary(job.salary);
  const posted = fmt.date(job.postedAt) ?? fmt.date(job.firstSeenAt);
  const fromBoard = job.applyMethod !== 'source';

  const facts: [string, string | null][] = [
    [t.role.facts.salary, salary],
    [t.role.facts.workMode, t.workplace[job.workplace]],
    [t.role.facts.canWorkFrom, eligibility(job, i18n)],
    [t.role.facts.location, job.locations.join(' · ') || null],
    [t.role.facts.level, job.seniority ? t.seniority[job.seniority] : null],
    [t.role.facts.type, job.employmentType ? t.employmentType[job.employmentType] : null],
    [t.role.facts.category, categoryName],
    [t.role.facts.payBand, job.companyTier ? `${t.payBand[job.companyTier]} (${t.payBandRange[job.companyTier]})` : null],
    [t.role.facts.posted, posted],
  ];
  const TitleTag = variant === 'page' ? 'h1' : 'h2';

  return (
    <article className={`job-detail job-detail--${variant}`} aria-label={t.role.label(job.title, job.company)}>
      {variant === 'pane' && (
        <div className="job-detail__toolbar">
          <Link href={jobPath(job.id)} className="link-button">
            {t.role.openFullPage}
          </Link>
          {onClose && (
            <button type="button" className="icon-button" onClick={onClose} aria-label={t.role.closePreview}>
              <Icon name="close" />
            </button>
          )}
        </div>
      )}

      {job.closedAt && (
        <div className="notice" role="status">
          {t.role.removed(fmt.relative(job.closedAt))}
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
          <a className="button button--primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
            {job.applyDirect ? t.role.applyEmployer : t.role.applyOn(job.sourceName)}
            <Icon name="external" size={16} />
          </a>
        )}
        <RoleMarkButtons role={job} variant="full" />
        <div className="apply-notes">
          <p className="verified">
            <span className="live__dot" aria-hidden="true" />
            {t.role.checked(fmt.relative(job.checkedAt))}
          </p>
          {!job.closedAt && <ReportClosedButton key={job.id} jobId={job.id} />}
          {job.applyDirect ? (
            <p className="apply-note">
              {rich(t.role.goesTo, {
                host: <span className="num">{hostOf(job.applyUrl)}</span>,
                method: t.role.applyMethods[job.applyMethod ?? 'source'],
              })}
              {fromBoard && (
                <>
                  {' '}
                  {rich(t.role.listedOn, {
                    source: (
                      <a href={job.url} target="_blank" rel="noopener noreferrer">
                        {job.sourceName}
                      </a>
                    ),
                  })}
                </>
              )}
            </p>
          ) : (
            <p className="apply-note apply-note--board">
              {t.role.boardOnly(job.sourceName)}
            </p>
          )}
        </div>
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
        <ul className="job-card__chips job-detail__skills" aria-label={t.role.stack}>
          {job.skills.map((s) => (
            <li key={s} className="skill">
              {s}
            </li>
          ))}
        </ul>
      )}

      <section className="job-detail__description" aria-label={t.role.description}>
        {job.description ? <Description text={job.description} /> : <p className="muted">{t.role.noDescription}</p>}
      </section>

      {job.alsoOn.length > 0 && (
        <p className="also-on">
          {t.role.alsoListedOn}{' '}
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
