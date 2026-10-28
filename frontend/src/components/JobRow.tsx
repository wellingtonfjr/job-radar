import type { Job } from '../api/types';
import { useRoleMarks } from '../hooks/useRoleMarks';
import { useI18n } from '../i18n';
import { jobPath } from '../lib/router';
import { CompanyLogo } from './CompanyLogo';
import { Link } from './Link';
import { RoleMarkButtons } from './RoleMarkButtons';

interface JobRowProps {
  job: Job;
  categoryName: string;
  isNew: boolean;
  selected?: boolean;
  /**
   * Called instead of navigating (split view). Plain navigation to the
   * detail page happens when it's absent or the click has modifiers.
   */
  onSelect?: () => void;
  onOpen?: () => void;
}

export function JobRow({ job, categoryName, isNew, selected = false, onSelect, onOpen }: JobRowProps) {
  const { t, fmt } = useI18n();
  const applied = Boolean(useRoleMarks()[job.id]?.appliedAt);
  const salary = fmt.salary(job.salary);
  const age = fmt.age(job.postedAt ?? job.firstSeenAt);
  const where = fmt.locations(job.locations, job.workplace, job.allowedCountries, 2).join(', ');
  const facts = [
    t.workplace[job.workplace],
    job.employmentType ? t.employmentType[job.employmentType] : null,
    job.seniority ? t.seniority[job.seniority] : null,
    // The catch-all category adds nothing to a card.
    job.category === 'other' ? null : categoryName,
  ].filter(Boolean);

  return (
    <article
      className={`job-card${selected ? ' job-card--selected' : ''}${applied ? ' job-card--applied' : ''}`}
      aria-current={selected ? 'true' : undefined}>
      <CompanyLogo name={job.company} src={job.companyLogo} />
      <div className="job-card__body">
        <div className="job-card__company">
          {job.company}
          {job.companyTier && <span className={`band band--${job.companyTier}`}>{t.payBand[job.companyTier]}</span>}
        </div>
        <h3 className="job-card__title">
          {/* Stretched over the card (see CSS) so the whole card is clickable. */}
          <Link
            href={jobPath(job.id)}
            className="job-card__link"
            onNavigate={onOpen}
            onClick={(event) => {
              if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              onSelect();
            }}
          >
            {job.title}
          </Link>
        </h3>
        <p className="job-card__facts">
          {facts.join(' · ')}
          {where && (
            <>
              {' · '}
              <span className="job-card__where">{where}</span>
            </>
          )}
        </p>
        {(salary || job.skills.length > 0) && (
          <ul className="job-card__chips" aria-label={t.row.salaryAndStack}>
            {salary && <li className="salary">{salary}</li>}
            {job.skills.slice(0, 4).map((skill) => (
              <li key={skill} className="skill">
                {skill}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="job-card__meta">
        {applied && <span className="applied-flag">{t.row.applied}</span>}
        {isNew && !applied && <span className="new-flag">{t.row.new}</span>}
        {age && <span className="age">{age}</span>}
        {!job.applyDirect && (
          <span className="via" title={t.row.viaTitle(job.sourceName)}>
            {t.row.via(job.sourceName)}
          </span>
        )}
      </div>
      <RoleMarkButtons role={job} variant="compact" />
    </article>
  );
}

export function JobRowSkeleton() {
  return (
    <div className="job-card job-card--skeleton" aria-hidden="true">
      <span className="company-logo skeleton" />
      <div className="job-card__body">
        <span className="skeleton skeleton--line skeleton--short" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line skeleton--mid" />
      </div>
    </div>
  );
}
