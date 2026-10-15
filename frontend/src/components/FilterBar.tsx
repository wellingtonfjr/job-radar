import type { EmploymentType, PayTier, Seniority, Stats, Workplace } from '../api/types';
import { countActiveFilters, EMPTY_FILTERS, toggle, type Filters } from '../lib/filters';
import { countryName } from '../lib/format';
import {
  EMPLOYMENT_TYPE_LABELS,
  MIN_SALARY_OPTIONS,
  POSTED_OPTIONS,
  SENIORITY_LABELS,
  TIER_LABELS,
  WORKPLACE_LABELS,
} from '../lib/labels';
import { FilterDropdown } from './FilterDropdown';
import { OptionList, type Option } from './OptionList';

interface FilterBarProps {
  filters: Filters;
  stats: Stats | null;
  onChange: (next: Filters) => void;
}

function entries<K extends string>(labels: Record<K, string>): Option[] {
  return (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));
}

const ANY = '';

export function FilterBar({ filters, stats, onChange }: FilterBarProps) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  const categoryOptions: Option[] = (stats?.categories ?? [])
    .filter((c) => c.count > 0 || filters.category.includes(c.id))
    .map((c) => ({ value: c.id, label: c.name, count: c.count }));

  const countryOptions: Option[] = [
    { value: ANY, label: 'Anywhere' },
    ...(stats?.countries ?? [])
      .map((code) => ({ value: code, label: countryName(code) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  const skillOptions: Option[] = (stats?.skills ?? []).map((s) => ({ value: s.name, label: s.name, count: s.count }));
  // Keep selected skills visible even if they dropped out of the top list.
  for (const skill of filters.skills) {
    if (!skillOptions.some((o) => o.value === skill)) skillOptions.push({ value: skill, label: skill });
  }

  const tierOptions: Option[] = (Object.entries(TIER_LABELS) as [PayTier, string][]).map(([value, label]) => ({
    value,
    label,
    count: stats?.tiers[value],
  }));

  const activeCount = countActiveFilters(filters);

  return (
    <div className="filter-bar" role="group" aria-label="Filters">
      <FilterDropdown label="Category" icon="📁" activeCount={filters.category.length} wide>
        <OptionList
          legend="Category"
          options={categoryOptions}
          selected={filters.category}
          onToggle={(v) => set('category', toggle(filters.category, v))}
        />
      </FilterDropdown>

      <FilterDropdown label={filters.country ? countryName(filters.country) : 'Your location'} icon="🌍" activeCount={filters.country ? 1 : 0}>
        <OptionList
          legend="Where you can work from"
          hint="Remote jobs open to this country, plus hybrid and on-site jobs located there."
          options={countryOptions}
          selected={[filters.country]}
          onToggle={(v) => set('country', v)}
          single
          searchable
        />
      </FilterDropdown>

      <FilterDropdown label="Work mode" icon="🏠" activeCount={filters.workplace.length}>
        <OptionList
          legend="Work mode"
          options={entries(WORKPLACE_LABELS)}
          selected={filters.workplace}
          onToggle={(v) => set('workplace', toggle(filters.workplace, v as Workplace))}
        />
      </FilterDropdown>

      <FilterDropdown label="Career level" icon="⭐" activeCount={filters.seniority.length}>
        <OptionList
          legend="Career level"
          options={entries(SENIORITY_LABELS)}
          selected={filters.seniority}
          onToggle={(v) => set('seniority', toggle(filters.seniority, v as Seniority))}
        />
      </FilterDropdown>

      <FilterDropdown label="Employment type" icon="💼" activeCount={filters.type.length}>
        <OptionList
          legend="Employment type"
          options={entries(EMPLOYMENT_TYPE_LABELS)}
          selected={filters.type}
          onToggle={(v) => set('type', toggle(filters.type, v as EmploymentType))}
        />
      </FilterDropdown>

      <FilterDropdown label="Stack" icon="🛠" activeCount={filters.skills.length} wide>
        <OptionList
          legend="Stack"
          hint="Jobs mentioning any of the selected technologies."
          options={skillOptions}
          selected={filters.skills}
          onToggle={(v) => set('skills', toggle(filters.skills, v))}
          searchable
        />
      </FilterDropdown>

      <FilterDropdown label="Minimum salary" icon="💰" activeCount={filters.minSalary ? 1 : 0}>
        <OptionList
          legend="Minimum salary (≈ USD / year)"
          hint="Only jobs that publish a salary. Other currencies are converted approximately."
          options={[
            { value: ANY, label: 'Any salary' },
            ...MIN_SALARY_OPTIONS.map((v) => ({ value: String(v), label: `$${v / 1000}k+` })),
          ]}
          selected={[filters.minSalary ? String(filters.minSalary) : ANY]}
          onToggle={(v) => set('minSalary', v ? Number(v) : null)}
          single
        />
      </FilterDropdown>

      <FilterDropdown label="Company tier" icon="🏆" activeCount={filters.tier.length}>
        <OptionList
          legend="Company pay tier"
          hint="From the median salary each company publishes in its own postings."
          options={tierOptions}
          selected={filters.tier}
          onToggle={(v) => set('tier', toggle(filters.tier, v as PayTier))}
        />
      </FilterDropdown>

      <FilterDropdown label="Posted" icon="🕒" activeCount={filters.postedWithin ? 1 : 0}>
        <OptionList
          legend="Date posted"
          options={[{ value: ANY, label: 'Any time' }, ...POSTED_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))]}
          selected={[filters.postedWithin ? String(filters.postedWithin) : ANY]}
          onToggle={(v) => set('postedWithin', v ? Number(v) : null)}
          single
        />
      </FilterDropdown>

      {activeCount > 0 && (
        <button type="button" className="chip chip--clear" onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q })}>
          Clear filters ({activeCount})
        </button>
      )}
    </div>
  );
}

