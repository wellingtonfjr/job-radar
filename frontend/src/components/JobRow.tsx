import type { Job } from '../api/types';
import { formatAge, formatSalary, locationChips } from '../lib/format';
import { EMPLOYMENT_TYPE_LABELS, SENIORITY_LABELS, WORKPLACE_LABELS } from '../lib/labels';
import { jobPath } from '../lib/router';
import { CompanyLogo } from './CompanyLogo';
import { Link } from './Link';

interface JobRowProps {
  job: Job;
  categoryName: string;
  isNew: boolean;
  onOpen?: () => void;
}

export function JobRow({ job, categoryName, isNew, onOpen }: JobRowProps) {
  const salary = formatSalary(job.salary);
  const age = formatAge(job.postedAt ?? job.firstSeenAt);

  return (
    <article className={`job-row${isNew ? ' job-row--new' : ''}`}>
      <CompanyLogo name={job.company} src={job.companyLogo} />
      <div className="job-row__main">
        <h3 className="job-row__title">
          {/* The title link is stretched over the whole row (see CSS). */}
          <Link href={jobPath(job.id)} className="job-row__link" onNavigate={onOpen}>
            {job.title}
          </Link>
          <span className="job-row__company">
            <span aria-hidden="true"> • </span>
            <span className="visually-hidden"> at </span>
            {job.company}
          </span>
        </h3>
        <ul className="tags" aria-label="Job details">
          <li className="tag">{categoryName}</li>
          {job.employmentType && <li className="tag">{EMPLOYMENT_TYPE_LABELS[job.employmentType]}</li>}
          {job.seniority && <li className="tag">{SENIORITY_LABELS[job.seniority]}</li>}
          {salary && <li className="tag tag--salary">{salary}</li>}
          {job.workplace !== 'remote' && <li className="tag tag--workplace">{WORKPLACE_LABELS[job.workplace]}</li>}
          {locationChips(job.locations, job.workplace, job.allowedCountries).map((loc) => (
            <li key={loc} className="tag tag--location">
              {loc}
            </li>
          ))}
          {job.skills.slice(0, 3).map((skill) => (
            <li key={skill} className="tag tag--skill">
              {skill}
            </li>
          ))}
        </ul>
      </div>
      <div className="job-row__aside">
        {job.companyTier && (
          <span className={`badge badge--tier badge--tier-${job.companyTier}`} title="Company pay tier, from the salaries it publishes">
            Tier {job.companyTier}
          </span>
        )}
        {isNew ? <span className="badge badge--new">New</span> : age && <span className="job-row__age">{age}</span>}
      </div>
    </article>
  );
}

export function JobRowSkeleton() {
  return (
    <div className="job-row job-row--skeleton" aria-hidden="true">
      <span className="company-logo company-logo--md skeleton" />
      <div className="job-row__main">
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--tags" />
      </div>
    </div>
  );
}
