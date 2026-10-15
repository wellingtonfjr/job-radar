import type { ReactNode } from 'react';

interface StatusMessageProps {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'error';
  action?: { label: string; onClick: () => void };
}

export function StatusMessage({ title, children, tone = 'neutral', action }: StatusMessageProps) {
  return (
    <div className={`status-message status-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="status-message__title">{title}</p>
      {children && <div className="status-message__body">{children}</div>}
      {action && (
        <button type="button" className="button button--secondary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
