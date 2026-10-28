import { useState } from 'react';
import { ApiError, reportClosed } from '../api/client';
import { errorMessage, useI18n } from '../i18n';

interface ReportClosedButtonProps {
  jobId: string;
}

type State = { status: 'idle' | 'sending' | 'sent' } | { status: 'failed'; message: string };

/**
 * "Role closed?": asks the API to re-check the role with the employer. It
 * never closes the role itself; the employer's answer decides.
 */
export function ReportClosedButton({ jobId }: ReportClosedButtonProps) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: 'idle' });

  const send = () => {
    setState({ status: 'sending' });
    reportClosed(jobId)
      .then(() => setState({ status: 'sent' }))
      .catch((err: unknown) => {
        // A rate limit says so; anything else is a plain "try later".
        const message = err instanceof ApiError && err.status === 429 ? errorMessage(err, t) : t.role.reportFailed;
        setState({ status: 'failed', message });
      });
  };

  if (state.status === 'sent') {
    return (
      <p className="report-closed report-closed--sent" role="status">
        {t.role.reportThanks}
      </p>
    );
  }
  return (
    <p className="report-closed">
      <button type="button" className="link-button" title={t.role.reportClosedHint} disabled={state.status === 'sending'} onClick={send}>
        {t.role.reportClosed}
      </button>
      {state.status === 'failed' && (
        <span className="report-closed__error" role="alert">
          {' '}
          {state.message}
        </span>
      )}
    </p>
  );
}
