import type { Stats } from '../api/types';
import { useJob } from '../hooks/useJob';
import { formatCount } from '../lib/format';
import { JobDetailView } from './JobDetailView';
import { StatusMessage } from './StatusMessage';

interface JobPreviewProps {
  id: string | null;
  stats: Stats | null;
  onClose: () => void;
}

/** Right-hand pane of the split view. */
export function JobPreview({ id, stats, onClose }: JobPreviewProps) {
  if (!id) {
    return (
      <div className="preview-empty">
        <p className="preview-empty__title">Select a role to preview it here</p>
        {stats && (
          <dl className="preview-stats">
            <div>
              <dt>Open roles</dt>
              <dd>{formatCount(stats.totals.openJobs)}</dd>
            </div>
            <div>
              <dt>Companies</dt>
              <dd>{formatCount(stats.totals.companies)}</dd>
            </div>
            <div>
              <dt>Remote</dt>
              <dd>{formatCount(stats.totals.remote)}</dd>
            </div>
            <div>
              <dt>With salary</dt>
              <dd>{formatCount(stats.totals.withSalary)}</dd>
            </div>
          </dl>
        )}
      </div>
    );
  }
  return <LoadedPreview key={id} id={id} stats={stats} onClose={onClose} />;
}

function LoadedPreview({ id, stats, onClose }: { id: string; stats: Stats | null; onClose: () => void }) {
  const { state, retry } = useJob(id);
  if (state.status === 'loading') {
    return (
      <div className="job-detail" aria-busy="true">
        <span className="skeleton skeleton--line skeleton--short" />
        <span className="skeleton skeleton--block" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <StatusMessage
        title={state.notFound ? 'This role is no longer listed' : "Couldn't load this role"}
        tone={state.notFound ? 'neutral' : 'error'}
        action={state.notFound ? { label: 'Close', onClick: onClose } : { label: 'Try again', onClick: retry }}
      >
        {state.notFound ? null : state.message}
      </StatusMessage>
    );
  }
  return <JobDetailView job={state.job} stats={stats} variant="pane" onClose={onClose} />;
}
