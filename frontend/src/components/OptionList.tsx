import { useId, useState } from 'react';

export interface Option {
  value: string;
  label: string;
  count?: number;
}

interface OptionListProps {
  label: string;
  options: Option[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  /** Radio behaviour: picking an option replaces the selection. */
  single?: boolean;
  searchable?: boolean;
  /** Show this many options until "Show all" is pressed (search shows all matches). */
  limit?: number;
}

/** Checkbox (or radio) list for the filter sidebar, optionally searchable. */
export function OptionList({ label, options, selected, onToggle, single = false, searchable = false, limit }: OptionListProps) {
  const [term, setTerm] = useState('');
  const [showAll, setShowAll] = useState(false);
  const name = useId();

  const needle = term.trim().toLowerCase();
  const matches = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  // Selected options always stay visible, even past the limit.
  const visible =
    limit && !showAll && !needle
      ? matches.filter((o, i) => i < limit || selected.includes(o.value))
      : matches;

  return (
    <div className="option-list" role="group" aria-label={label}>
      {searchable && (
        <div className="option-list__search">
          <input
            type="search"
            placeholder={`Search ${label.toLowerCase()}`}
            aria-label={`Search ${label.toLowerCase()}`}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
      )}
      <div className="option-list__items">
        {visible.map((option) => (
          <label key={option.value} className="option">
            <input
              type={single ? 'radio' : 'checkbox'}
              name={name}
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            <span className="option__label">{option.label}</span>
            {option.count !== undefined && <span className="option__count">{option.count.toLocaleString('en')}</span>}
          </label>
        ))}
        {visible.length === 0 && <p className="option-list__empty">No matches</p>}
      </div>
      {limit && !needle && matches.length > visible.length && (
        <button type="button" className="link-button" onClick={() => setShowAll(true)}>
          Show all {matches.length}
        </button>
      )}
    </div>
  );
}
