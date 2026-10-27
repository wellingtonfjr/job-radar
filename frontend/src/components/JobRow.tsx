import type { Job } from '../api/types';
import { useRoleMarks } from '../hooks/useRoleMarks';
import { formatAge, formatSalary, locationChips } from '../lib/format';
import { EMPLOYMENT_TYPE_LABELS, PAY_BAND_LABELS, SENIORITY_LABELS, WORKPLACE_LABELS } from '../lib/labels';
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
  const applied = Boolean(useRoleMarks()[job.id]?.appliedAt);
  const salary = formatSalary(job.salary);
  const age = formatAge(job.postedAt ?? job.firstSeenAt);
  const where = locationChips(job.locations, job.workplace, job.allowedCountries, 2).join(', ');
  const facts = [
    WORKPLACE_LABELS[job.workplace],
    job.employmentType ? EMPLOYMENT_TYPE_LABELS[job.employmentType] : null,
    job.seniority ? SENIORITY_LABELS[job.seniority] : null,
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
          {job.companyTier && <span className={`band band--${job.companyTier}`}>{PAY_BAND_LABELS[job.companyTier]}</span>}
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
          <ul className="job-card__chips" aria-label="Salary and stack">
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
        {applied && <span className="applied-flag">Applied</span>}
        {isNew && !applied && <span className="new-flag">New</span>}
        {age && <span className="age">{age.replace(' ago', '')}</span>}
        {!job.applyDirect && (
          <span className="via" title={`No employer posting found yet; applying goes through ${job.sourceName}`}>
            via {job.sourceName}
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
