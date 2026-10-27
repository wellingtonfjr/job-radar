interface Pill {
  value: string;
  label: string;
  hint?: string;
}

interface PillGroupProps {
  label: string;
  pills: Pill[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}

/** Compact toggle buttons for short option sets (work mode, level, posted…). */
export function PillGroup({ label, pills, selected, onToggle }: PillGroupProps) {
  return (
    <div className="pill-group" role="group" aria-label={label}>
      {pills.map((pill) => {
        const active = selected.includes(pill.value);
        return (
          <button
            key={pill.value}
            type="button"
            className={`pill${active ? ' pill--active' : ''}`}
            aria-pressed={active}
            onClick={() => onToggle(pill.value)}
          >
            {pill.label}
            {pill.hint && <span className="pill__hint">{pill.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
