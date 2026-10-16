import type { EmploymentType, PayTier, Seniority, Stats, Workplace } from '../api/types';
import { countActiveFilters, EMPTY_FILTERS, toggle, type Filters } from '../lib/filters';
import { countryName } from '../lib/format';
import {
  EMPLOYMENT_TYPE_LABELS,
  MIN_SALARY_OPTIONS,
  PAY_BAND_LABELS,
  PAY_BAND_RANGES,
  POSTED_OPTIONS,
  SENIORITY_LABELS,
  WORKPLACE_LABELS,
} from '../lib/labels';
import { FilterSection } from './FilterSection';
import { OptionList, type Option } from './OptionList';
import { PillGroup } from './PillGroup';

interface FilterPanelProps {
  filters: Filters;
  stats: Stats | null;
  onChange: (next: Filters) => void;
}

function pillsOf<K extends string>(labels: Record<K, string>) {
  return (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));
}

const ANY = '';

// Most-searched hiring countries first, then alphabetical.
const PRIORITY_COUNTRIES = ['US', 'GB', 'CA', 'DE', 'BR', 'IN', 'FR', 'ES', 'PT', 'NL', 'PL', 'MX', 'AR', 'AU', 'IE'];

function countryRank(code: string): number {
  const i = PRIORITY_COUNTRIES.indexOf(code);
  return i === -1 ? PRIORITY_COUNTRIES.length : i;
}

/** Every filter, grouped in collapsible sections (sidebar on desktop, sheet on mobile). */
export function FilterPanel({ filters, stats, onChange }: FilterPanelProps) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  /** Single-choice pills: pressing the active one clears it. */
  const single = (current: number | null, value: string) => (Number(value) === current ? null : Number(value));

  const categoryOptions: Option[] = (stats?.categories ?? [])
    .filter((c) => c.count > 0 || filters.category.includes(c.id))
    // "All Others" is a catch-all, so it goes last regardless of size.
    .sort((a, b) => Number(a.id === 'other') - Number(b.id === 'other') || b.count - a.count)
    .map((c) => ({ value: c.id, label: c.name, count: c.count }));

  const countryOptions: Option[] = [
    { value: ANY, label: 'Anywhere' },
    ...(stats?.countries ?? [])
      .map((code) => ({ value: code, label: countryName(code) }))
      .sort((a, b) => countryRank(a.value) - countryRank(b.value) || a.label.localeCompare(b.label)),
  ];

  const skillOptions: Option[] = (stats?.skills ?? []).map((s) => ({ value: s.name, label: s.name, count: s.count }));
  for (const skill of filters.skills) {
    if (!skillOptions.some((o) => o.value === skill)) skillOptions.push({ value: skill, label: skill });
  }

  const activeCount = countActiveFilters(filters);

  return (
    <div className="filter-panel">
      <div className="filter-panel__header">
        <h2 className="filter-panel__title">Filters</h2>
        {activeCount > 0 && (
          <button type="button" className="link-button" onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q })}>
            Reset all
          </button>
        )}
      </div>

      <label className="switch">
        <input type="checkbox" checked={filters.direct} onChange={(e) => set('direct', e.target.checked)} />
        <span className="switch__text">
          <strong>Employer's own posting only</strong>
          <span>Hide roles we can only link to a job board for.</span>
        </span>
      </label>

      <FilterSection title="Work mode" activeCount={filters.workplace.length} defaultOpen>
        <PillGroup
          label="Work mode"
          pills={pillsOf(WORKPLACE_LABELS)}
          selected={filters.workplace}
          onToggle={(v) => set('workplace', toggle(filters.workplace, v as Workplace))}
        />
      </FilterSection>

      <FilterSection title="Can work from" activeCount={filters.country ? 1 : 0} defaultOpen>
        <p className="filter-hint">Remote roles open to this country, plus hybrid and on-site roles located there.</p>
        <OptionList
          label="Country"
          options={countryOptions}
          selected={[filters.country]}
          onToggle={(v) => set('country', v)}
          single
          searchable
          limit={6}
        />
      </FilterSection>

      <FilterSection title="Category" activeCount={filters.category.length} defaultOpen>
        <OptionList
          label="Category"
          options={categoryOptions}
          selected={filters.category}
          onToggle={(v) => set('category', toggle(filters.category, v))}
          limit={6}
        />
      </FilterSection>

      <FilterSection title="Career level" activeCount={filters.seniority.length} defaultOpen>
        <PillGroup
          label="Career level"
          pills={pillsOf(SENIORITY_LABELS)}
          selected={filters.seniority}
          onToggle={(v) => set('seniority', toggle(filters.seniority, v as Seniority))}
        />
      </FilterSection>

      <FilterSection title="Minimum salary" activeCount={filters.minSalary ? 1 : 0} defaultOpen>
        <PillGroup
          label="Minimum salary"
          pills={MIN_SALARY_OPTIONS.map((v) => ({ value: String(v), label: `$${v / 1000}k+` }))}
          selected={filters.minSalary ? [String(filters.minSalary)] : []}
          onToggle={(v) => set('minSalary', single(filters.minSalary, v))}
        />
        <p className="filter-hint">≈ USD per year. Only roles that publish a salary.</p>
      </FilterSection>

      <FilterSection title="Stack" activeCount={filters.skills.length}>
        <OptionList
          label="Stack"
          options={skillOptions}
          selected={filters.skills}
          onToggle={(v) => set('skills', toggle(filters.skills, v))}
          searchable
          limit={8}
        />
      </FilterSection>

      <FilterSection title="Employment type" activeCount={filters.type.length}>
        <PillGroup
          label="Employment type"
          pills={pillsOf(EMPLOYMENT_TYPE_LABELS)}
          selected={filters.type}
          onToggle={(v) => set('type', toggle(filters.type, v as EmploymentType))}
        />
      </FilterSection>

      <FilterSection title="Pay band" activeCount={filters.tier.length}>
        <PillGroup
          label="Pay band"
          pills={(Object.keys(PAY_BAND_LABELS) as PayTier[]).map((band) => ({
            value: band,
            label: PAY_BAND_LABELS[band],
            hint: PAY_BAND_RANGES[band],
          }))}
          selected={filters.tier}
          onToggle={(v) => set('tier', toggle(filters.tier, v as PayTier))}
        />
        <p className="filter-hint">Median salary the company publishes across its open roles.</p>
      </FilterSection>

      <FilterSection title="Posted within" activeCount={filters.postedWithin ? 1 : 0}>
        <PillGroup
          label="Posted within"
          pills={POSTED_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          selected={filters.postedWithin ? [String(filters.postedWithin)] : []}
          onToggle={(v) => set('postedWithin', single(filters.postedWithin, v))}
        />
      </FilterSection>
    </div>
  );
}
