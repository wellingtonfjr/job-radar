import { countryName } from '../countries';
import type { Job } from '../types';
import { formatRelativeDate } from '../utils/formatDate';

interface JobCardProps {
  job: Job;
  isNew: boolean;
}

export function JobCard({ job, isNew }: JobCardProps) {
  return (
    <article className="job-card">
      <header className="job-card-header">
        <a
          className="job-title"
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {job.title}
        </a>
        {isNew && <span className="badge badge-new">New</span>}
      </header>

      <div className="job-company">{job.company}</div>

      <div className="job-meta">
        {job.remote && <span className="badge badge-remote">Remote</span>}
        {job.location && <span className="job-location">{job.location}</span>}
        {!job.remote && !job.location && (
          <span className="job-location job-location-unknown">Location unknown</span>
        )}
        <span className="badge badge-source">{job.source}</span>
        <span className="job-date">{formatRelativeDate(job.postedAt)}</span>
      </div>

      {job.remote && (
        <div className="job-eligibility">
          {job.allowedCountries ? (
            <span className="eligibility-restricted">
              Open to: {job.allowedCountries.map(countryName).join(', ')}
            </span>
          ) : (
            <span className="eligibility-open">Open to any location</span>
          )}
        </div>
      )}

      {job.tags.length > 0 && (
        <div className="job-tags">
          {job.tags.slice(0, 8).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
