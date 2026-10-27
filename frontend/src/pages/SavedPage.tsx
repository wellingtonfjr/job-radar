import { useEffect } from 'react';
import { CompanyLogo } from '../components/CompanyLogo';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { RoleMarkButtons } from '../components/RoleMarkButtons';
import { StatusMessage } from '../components/StatusMessage';
import { useRoleMarks } from '../hooks/useRoleMarks';
import { formatRelative } from '../lib/format';
import { jobPath } from '../lib/router';
import { savedRoles } from '../lib/savedRoles';

/** Roles saved in this browser, shown from their stored snapshot (they may have closed since). */
export function SavedPage() {
  const roles = savedRoles(useRoleMarks());

  useEffect(() => {
    document.title = 'Saved roles · job-radar';
    window.scrollTo(0, 0);
  }, []);

  return (
    <main className="page" id="main">
      <Link href="/" className="back-link">
        <Icon name="back" size={16} /> All roles
      </Link>
      <header className="saved-header">
        <h1 className="saved-header__title">Saved roles</h1>
        <p className="saved-header__note">Kept in this browser only.</p>
      </header>
      {roles.length === 0 ? (
        <StatusMessage title="No saved roles yet">
          Use the star on a role to keep it here. <Link href="/">Browse open roles</Link>
        </StatusMessage>
      ) : (
        <div className="job-list">
          {roles.map((role) => (
            <article key={role.id} className={`job-card${role.appliedAt ? ' job-card--applied' : ''}`}>
              <CompanyLogo name={role.company} src={role.companyLogo} />
              <div className="job-card__body">
                <div className="job-card__company">{role.company}</div>
                <h2 className="job-card__title">
                  <Link href={jobPath(role.id)} className="job-card__link">
                    {role.title}
                  </Link>
                </h2>
                <p className="job-card__facts">
                  Saved {formatRelative(role.savedAt)}
                  {role.appliedAt && ` · applied ${formatRelative(role.appliedAt)}`}
                </p>
              </div>
              <div className="job-card__meta">{role.appliedAt && <span className="applied-flag">Applied</span>}</div>
              <RoleMarkButtons role={role} variant="compact" />
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
