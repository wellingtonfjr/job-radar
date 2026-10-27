import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface FilterSectionProps {
  title: string;
  activeCount: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible sidebar section; stays open while it has active filters. */
export function FilterSection({ title, activeCount, defaultOpen = false, children }: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen || activeCount > 0);
  const bodyId = useId();
  return (
    <section className={`filter-section${open ? ' filter-section--open' : ''}`}>
      <h3 className="filter-section__heading">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          <span>{title}</span>
          {activeCount > 0 && <span className="count-dot">{activeCount}</span>}
          <Icon name="chevron" size={16} />
        </button>
      </h3>
      <div id={bodyId} className="filter-section__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
