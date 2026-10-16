import type { Stats } from '../api/types';
import { EMPTY_FILTERS, type Filters } from '../lib/filters';
import { countryName } from '../lib/format';
import { EMPLOYMENT_TYPE_LABELS, PAY_BAND_LABELS, POSTED_OPTIONS, SENIORITY_LABELS, WORKPLACE_LABELS } from '../lib/labels';
import { Icon } from './Icon';

interface ActiveFiltersProps {
  filters: Filters;
  stats: Stats | null;
  onChange: (next: Filters) => void;
}

interface Token {
  key: string;
  label: string;
  remove: () => Filters;
}

/** One removable token per active filter value, above the results. */
export function ActiveFilters({ filters, stats, onChange }: ActiveFiltersProps) {
  const without = <K extends 'category' | 'workplace' | 'seniority' | 'type' | 'skills' | 'tier'>(key: K, value: string): Filters => ({
    ...filters,
    [key]: (filters[key] as string[]).filter((v) => v !== value),
  });

  const tokens: Token[] = [
    ...(filters.direct ? [{ key: 'direct', label: 'Employer posting only', remove: () => ({ ...filters, direct: false }) }] : []),
    ...(filters.q.trim() ? [{ key: 'q', label: `“${filters.q.trim()}”`, remove: () => ({ ...filters, q: '' }) }] : []),
    ...filters.workplace.map((v) => ({ key: `wp-${v}`, label: WORKPLACE_LABELS[v], remove: () => without('workplace', v) })),
    ...(filters.country
      ? [{ key: 'country', label: `From ${countryName(filters.country)}`, remove: () => ({ ...filters, country: '' }) }]
      : []),
    ...filters.category.map((v) => ({
      key: `cat-${v}`,
      label: stats?.categories.find((c) => c.id === v)?.name ?? v,
      remove: () => without('category', v),
    })),
    ...filters.seniority.map((v) => ({ key: `sen-${v}`, label: SENIORITY_LABELS[v], remove: () => without('seniority', v) })),
    ...(filters.minSalary
      ? [{ key: 'salary', label: `$${filters.minSalary / 1000}k+`, remove: () => ({ ...filters, minSalary: null }) }]
      : []),
    ...filters.skills.map((v) => ({ key: `skill-${v}`, label: v, remove: () => without('skills', v) })),
    ...filters.type.map((v) => ({ key: `type-${v}`, label: EMPLOYMENT_TYPE_LABELS[v], remove: () => without('type', v) })),
    ...filters.tier.map((v) => ({ key: `tier-${v}`, label: PAY_BAND_LABELS[v], remove: () => without('tier', v) })),
    ...(filters.postedWithin
      ? [{
          key: 'posted',
          label: `Last ${POSTED_OPTIONS.find((o) => o.value === filters.postedWithin)?.label ?? `${filters.postedWithin} days`}`,
          remove: () => ({ ...filters, postedWithin: null }),
        }]
      : []),
  ];

  if (tokens.length === 0) return null;

  return (
    <div className="active-filters" aria-label="Active filters">
      <ul>
        {tokens.map((t) => (
          <li key={t.key}>
            <button type="button" className="token" onClick={() => onChange(t.remove())} aria-label={`Remove filter ${t.label}`}>
              {t.label}
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {tokens.length > 1 && (
        <button type="button" className="link-button" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear all
        </button>
      )}
    </div>
  );
}
