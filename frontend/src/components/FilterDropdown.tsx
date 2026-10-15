import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface FilterDropdownProps {
  label: string;
  icon: string;
  /** Shown as a count badge; the chip is highlighted when > 0. */
  activeCount: number;
  children: ReactNode;
  wide?: boolean;
}

/**
 * A filter "chip" that opens a popover panel. Closes on outside click and
 * Escape (returning focus to the chip), like a native menu button.
 */
export function FilterDropdown({ label, icon, activeCount, children, wide = false }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="filter-dropdown" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`chip chip--filter${activeCount > 0 ? ' chip--active' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{icon}</span>
        {label}
        {activeCount > 0 && (
          <span className="chip__count" aria-label={`${activeCount} selected`}>
            {activeCount}
          </span>
        )}
        <span className="chip__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label={`${label} filter`} className={`filter-panel${wide ? ' filter-panel--wide' : ''}`}>
          {children}
        </div>
      )}
    </div>
  );
}
