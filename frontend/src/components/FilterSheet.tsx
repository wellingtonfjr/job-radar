import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  resultLabel: string;
  children: ReactNode;
}

/** Full-screen filter sheet for small screens (a modal dialog). */
export function FilterSheet({ open, onClose, resultLabel, children }: FilterSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    // The native <dialog> handles Escape, focus trapping and the backdrop.
    <dialog ref={dialogRef} className="sheet" aria-label="Filters" onClose={onClose} onCancel={onClose}>
      <div className="sheet__top">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close filters">
          <Icon name="close" />
        </button>
      </div>
      {/* Mounted only while open, so the page has one live copy of the filters. */}
      <div className="sheet__body">{open && children}</div>
      <div className="sheet__footer">
        <button type="button" className="button button--primary button--block" onClick={onClose}>
          {resultLabel}
        </button>
      </div>
    </dialog>
  );
}
