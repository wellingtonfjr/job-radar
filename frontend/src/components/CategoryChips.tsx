import { useState } from 'react';
import type { Stats } from '../api/types';
import { toggle } from '../lib/filters';

interface CategoryChipsProps {
  categories: Stats['categories'];
  selected: string[];
  onChange: (next: string[]) => void;
}

const COLLAPSED_COUNT = 7;

/** Quick category toggles, most common first (like Remotive's chip row). */
export function CategoryChips({ categories, selected, onChange }: CategoryChipsProps) {
  const [expanded, setExpanded] = useState(false);
  const ranked = [...categories].filter((c) => c.count > 0 && c.id !== 'other').sort((a, b) => b.count - a.count);
  const visible = expanded ? ranked : ranked.slice(0, COLLAPSED_COUNT);
  if (ranked.length === 0) return null;

  return (
    <div className="category-chips">
      <span className="category-chips__label" id="category-chips-label">
        Categories
      </span>
      <ul className="category-chips__list" aria-labelledby="category-chips-label">
        {visible.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`chip chip--category${selected.includes(c.id) ? ' chip--active' : ''}`}
              aria-pressed={selected.includes(c.id)}
              onClick={() => onChange(toggle(selected, c.id))}
            >
              {c.name}
            </button>
          </li>
        ))}
        {ranked.length > COLLAPSED_COUNT && (
          <li>
            <button type="button" className="chip chip--category chip--more" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show less' : 'Show more'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
