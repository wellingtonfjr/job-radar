import { useEffect } from 'react';
import type { Stats } from '../api/types';
import { Icon } from '../components/Icon';
import { JobDetailView } from '../components/JobDetailView';
import { Link } from '../components/Link';
import { StatusMessage } from '../components/StatusMessage';
import { useJob } from '../hooks/useJob';

interface JobDetailPageProps {
  id: string;
  stats: Stats | null;
}

export function JobDetailPage({ id, stats }: JobDetailPageProps) {
  const { state, retry } = useJob(id);

  useEffect(() => {
    if (state.status === 'ready') document.title = `${state.job.title} at ${state.job.company} · job-radar`;
  }, [state]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  return (
    <main className="page page--detail" id="main">
      <Link href="/" className="back-link">
        <Icon name="back" size={16} /> All roles
      </Link>
      {state.status === 'loading' && (
        <div className="job-detail" aria-busy="true">
          <span className="skeleton skeleton--line skeleton--short" />
          <span className="skeleton skeleton--block" />
        </div>
      )}
      {state.status === 'error' && (
        <StatusMessage
          title={state.notFound ? 'This role is no longer listed' : "Couldn't load this role"}
          tone={state.notFound ? 'neutral' : 'error'}
          action={state.notFound ? undefined : { label: 'Try again', onClick: retry }}
        >
          {state.notFound ? <Link href="/">Browse open roles</Link> : state.message}
        </StatusMessage>
      )}
      {state.status === 'ready' && <JobDetailView job={state.job} stats={stats} variant="page" />}
    </main>
  );
}
