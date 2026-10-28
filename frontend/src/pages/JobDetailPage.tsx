import { useEffect } from 'react';
import type { Stats } from '../api/types';
import { Icon } from '../components/Icon';
import { JobDetailView } from '../components/JobDetailView';
import { Link } from '../components/Link';
import { StatusMessage } from '../components/StatusMessage';
import { useJob } from '../hooks/useJob';
import { errorMessage, useI18n } from '../i18n';

interface JobDetailPageProps {
  id: string;
  stats: Stats | null;
}

export function JobDetailPage({ id, stats }: JobDetailPageProps) {
  const { t } = useI18n();
  const { state, retry } = useJob(id);

  useEffect(() => {
    if (state.status === 'ready') document.title = t.role.pageTitle(state.job.title, state.job.company);
  }, [state, t]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  return (
    <main className="page page--detail" id="main">
      <Link href="/" className="back-link">
        <Icon name="back" size={16} /> {t.app.allRoles}
      </Link>
      {state.status === 'loading' && (
        <div className="job-detail" aria-busy="true">
          <span className="skeleton skeleton--line skeleton--short" />
          <span className="skeleton skeleton--block" />
        </div>
      )}
      {state.status === 'error' && (
        <StatusMessage
          title={state.notFound ? t.role.notFound : t.role.loadError}
          tone={state.notFound ? 'neutral' : 'error'}
          action={state.notFound ? undefined : { label: t.app.tryAgain, onClick: retry }}
        >
          {state.notFound ? <Link href="/">{t.app.browseRoles}</Link> : errorMessage(state.error, t)}
        </StatusMessage>
      )}
      {state.status === 'ready' && <JobDetailView job={state.job} stats={stats} variant="page" />}
    </main>
  );
}
