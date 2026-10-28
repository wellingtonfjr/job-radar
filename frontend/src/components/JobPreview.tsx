import type { Stats } from '../api/types';
import { useJob } from '../hooks/useJob';
import { errorMessage, useI18n } from '../i18n';
import { JobDetailView } from './JobDetailView';
import { StatusMessage } from './StatusMessage';

interface JobPreviewProps {
  id: string;
  stats: Stats | null;
  onClose: () => void;
}

/** Right-hand pane of the split view, shown only while a role is selected. */
export function JobPreview({ id, stats, onClose }: JobPreviewProps) {
  const { t } = useI18n();
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
        title={state.notFound ? t.role.notFound : t.role.loadError}
        tone={state.notFound ? 'neutral' : 'error'}
        action={state.notFound ? { label: t.app.close, onClick: onClose } : { label: t.app.tryAgain, onClick: retry }}
      >
        {state.notFound ? null : errorMessage(state.error, t)}
      </StatusMessage>
    );
  }
  return <JobDetailView job={state.job} stats={stats} variant="pane" onClose={onClose} />;
}
