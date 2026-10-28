import type { Stats } from '../api/types';
import { EMPTY_FILTERS, type Filters } from '../lib/filters';
import { useI18n } from '../i18n';
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
  const { t, fmt } = useI18n();
  const without = <K extends 'category' | 'workplace' | 'seniority' | 'type' | 'skills' | 'tier'>(key: K, value: string): Filters => ({
    ...filters,
    [key]: (filters[key] as string[]).filter((v) => v !== value),
  });

  const tokens: Token[] = [
    ...(filters.direct ? [{ key: 'direct', label: t.activeFilters.direct, remove: () => ({ ...filters, direct: false }) }] : []),
    ...(filters.q.trim() ? [{ key: 'q', label: `“${filters.q.trim()}”`, remove: () => ({ ...filters, q: '' }) }] : []),
    ...filters.workplace.map((v) => ({ key: `wp-${v}`, label: t.workplace[v], remove: () => without('workplace', v) })),
    ...(filters.country
      ? [{ key: 'country', label: t.activeFilters.from(fmt.country(filters.country)), remove: () => ({ ...filters, country: '' }) }]
      : []),
    ...filters.category.map((v) => ({
      key: `cat-${v}`,
      label: fmt.category(v, stats?.categories.find((c) => c.id === v)?.name),
      remove: () => without('category', v),
    })),
    ...filters.seniority.map((v) => ({ key: `sen-${v}`, label: t.seniority[v], remove: () => without('seniority', v) })),
    ...(filters.minSalary
      ? [{ key: 'salary', label: t.filters.salaryAtLeast(filters.minSalary), remove: () => ({ ...filters, minSalary: null }) }]
      : []),
    ...filters.skills.map((v) => ({ key: `skill-${v}`, label: v, remove: () => without('skills', v) })),
    ...filters.type.map((v) => ({ key: `type-${v}`, label: t.employmentType[v], remove: () => without('type', v) })),
    ...filters.tier.map((v) => ({ key: `tier-${v}`, label: t.payBand[v], remove: () => without('tier', v) })),
    ...(filters.postedWithin
      ? [{
          key: 'posted',
          label: t.activeFilters.posted(filters.postedWithin),
          remove: () => ({ ...filters, postedWithin: null }),
        }]
      : []),
  ];

  if (tokens.length === 0) return null;

  return (
    <div className="active-filters" aria-label={t.activeFilters.label}>
      <ul>
        {tokens.map((token) => (
          <li key={token.key}>
            <button type="button" className="token" onClick={() => onChange(token.remove())} aria-label={t.activeFilters.remove(token.label)}>
              {token.label}
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {tokens.length > 1 && (
        <button type="button" className="link-button" onClick={() => onChange(EMPTY_FILTERS)}>
          {t.activeFilters.clearAll}
        </button>
      )}
    </div>
  );
}
