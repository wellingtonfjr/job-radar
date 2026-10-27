import type { Stats } from '../api/types';
import { useJob } from '../hooks/useJob';
import { JobDetailView } from './JobDetailView';
import { StatusMessage } from './StatusMessage';

interface JobPreviewProps {
  id: string;
  stats: Stats | null;
  onClose: () => void;
}

/** Right-hand pane of the split view, shown only while a role is selected. */
export function JobPreview({ id, stats, onClose }: JobPreviewProps) {
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
