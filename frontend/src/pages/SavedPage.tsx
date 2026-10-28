import { useEffect } from 'react';
import { CompanyLogo } from '../components/CompanyLogo';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { RoleMarkButtons } from '../components/RoleMarkButtons';
import { StatusMessage } from '../components/StatusMessage';
import { useRoleMarks } from '../hooks/useRoleMarks';
import { useI18n } from '../i18n';
import { jobPath } from '../lib/router';
import { savedRoles } from '../lib/savedRoles';

/** Roles saved in this browser, shown from their stored snapshot (they may have closed since). */
export function SavedPage() {
  const { t, fmt } = useI18n();
  const roles = savedRoles(useRoleMarks());

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    document.title = t.saved.pageTitle;
  }, [t]);

  return (
    <main className="page" id="main">
      <Link href="/" className="back-link">
        <Icon name="back" size={16} /> {t.app.allRoles}
      </Link>
      <header className="saved-header">
        <h1 className="saved-header__title">{t.saved.title}</h1>
        <p className="saved-header__note">{t.saved.note}</p>
      </header>
      {roles.length === 0 ? (
        <StatusMessage title={t.saved.empty}>
          {t.saved.emptyHint} <Link href="/">{t.app.browseRoles}</Link>
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
                  {role.savedAt && t.saved.savedAgo(fmt.relative(role.savedAt))}
                  {role.appliedAt && ` · ${t.saved.appliedAgo(fmt.relative(role.appliedAt))}`}
                </p>
              </div>
              <div className="job-card__meta">{role.appliedAt && <span className="applied-flag">{t.row.applied}</span>}</div>
              <RoleMarkButtons role={role} variant="compact" />
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
