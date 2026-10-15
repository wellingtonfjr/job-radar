import { useId, useState } from 'react';

export interface Option {
  value: string;
  label: string;
  count?: number;
}

interface OptionListProps {
  legend: string;
  options: Option[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  /** Radio behaviour: picking an option replaces the selection. */
  single?: boolean;
  searchable?: boolean;
  hint?: string;
}

/** Checkbox (or radio) list used inside filter panels, optionally searchable. */
export function OptionList({ legend, options, selected, onToggle, single = false, searchable = false, hint }: OptionListProps) {
  const [term, setTerm] = useState('');
  const name = useId();
  const visible = term
    ? options.filter((o) => o.label.toLowerCase().includes(term.trim().toLowerCase()))
    : options;

  return (
    <fieldset className="option-list">
      <legend className="option-list__legend">{legend}</legend>
      {hint && <p className="option-list__hint">{hint}</p>}
      {searchable && (
        <input
          type="search"
          className="option-list__search"
          placeholder={`Search ${legend.toLowerCase()}…`}
          aria-label={`Search ${legend.toLowerCase()}`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
        />
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
    </fieldset>
  );
}
