import type { EmploymentType, PayTier, Seniority, Stats, Workplace } from '../api/types';
import { useI18n } from '../i18n';
import { countActiveFilters, EMPTY_FILTERS, SENIORITIES, TIERS, toggle, TYPES, WORKPLACES, type Filters } from '../lib/filters';
import { MIN_SALARY_OPTIONS, POSTED_WITHIN_DAYS } from '../lib/labels';
import { FilterSection } from './FilterSection';
import { OptionList, type Option } from './OptionList';
import { PillGroup } from './PillGroup';

interface FilterPanelProps {
  filters: Filters;
  stats: Stats | null;
  onChange: (next: Filters) => void;
}

function pillsOf<K extends string>(values: readonly K[], labels: Record<K, string>) {
  return values.map((value) => ({ value, label: labels[value] }));
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
  const { locale, t, fmt } = useI18n();
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  /** Single-choice pills: pressing the active one clears it. */
  const single = (current: number | null, value: string) => (Number(value) === current ? null : Number(value));

  const categoryOptions: Option[] = (stats?.categories ?? [])
    .filter((c) => c.count > 0 || filters.category.includes(c.id))
    // "All Others" is a catch-all, so it goes last regardless of size.
    .sort((a, b) => Number(a.id === 'other') - Number(b.id === 'other') || b.count - a.count)
    .map((c) => ({ value: c.id, label: fmt.category(c.id, c.name), count: c.count }));

  const countryOptions: Option[] = [
    { value: ANY, label: t.filters.anywhere },
    ...(stats?.countries ?? [])
      .map((code) => ({ value: code, label: fmt.country(code) }))
      .sort((a, b) => countryRank(a.value) - countryRank(b.value) || a.label.localeCompare(b.label, locale)),
  ];

  const skillOptions: Option[] = (stats?.skills ?? []).map((s) => ({ value: s.name, label: s.name, count: s.count }));
  for (const skill of filters.skills) {
    if (!skillOptions.some((o) => o.value === skill)) skillOptions.push({ value: skill, label: skill });
  }

  const activeCount = countActiveFilters(filters);

  return (
    <div className="filter-panel">
      <div className="filter-panel__header">
        <h2 className="filter-panel__title">{t.filters.title}</h2>
        {activeCount > 0 && (
          <button type="button" className="link-button" onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q })}>
            {t.filters.resetAll}
          </button>
        )}
      </div>

      <label className="switch">
        <input type="checkbox" checked={filters.direct} onChange={(e) => set('direct', e.target.checked)} />
        <span className="switch__text">
          <strong>{t.filters.directOnly}</strong>
          <span>{t.filters.directOnlyHint}</span>
        </span>
      </label>

      <FilterSection title={t.filters.workMode} activeCount={filters.workplace.length} defaultOpen>
        <PillGroup
          label={t.filters.workMode}
          pills={pillsOf(WORKPLACES, t.workplace)}
          selected={filters.workplace}
          onToggle={(v) => set('workplace', toggle(filters.workplace, v as Workplace))}
        />
      </FilterSection>

      <FilterSection title={t.filters.canWorkFrom} activeCount={filters.country ? 1 : 0} defaultOpen>
        <p className="filter-hint">{t.filters.canWorkFromHint}</p>
        <OptionList
          label={t.filters.country}
          options={countryOptions}
          selected={[filters.country]}
          onToggle={(v) => set('country', v)}
          single
          searchable
          limit={6}
        />
      </FilterSection>

      <FilterSection title={t.filters.category} activeCount={filters.category.length} defaultOpen>
        <OptionList
          label={t.filters.category}
          options={categoryOptions}
          selected={filters.category}
          onToggle={(v) => set('category', toggle(filters.category, v))}
          limit={6}
        />
      </FilterSection>

      <FilterSection title={t.filters.careerLevel} activeCount={filters.seniority.length} defaultOpen>
        <PillGroup
          label={t.filters.careerLevel}
          pills={pillsOf(SENIORITIES, t.seniority)}
          selected={filters.seniority}
          onToggle={(v) => set('seniority', toggle(filters.seniority, v as Seniority))}
        />
      </FilterSection>

      <FilterSection title={t.filters.minSalary} activeCount={filters.minSalary ? 1 : 0} defaultOpen>
        <PillGroup
          label={t.filters.minSalary}
          pills={MIN_SALARY_OPTIONS.map((v) => ({ value: String(v), label: t.filters.salaryAtLeast(v) }))}
          selected={filters.minSalary ? [String(filters.minSalary)] : []}
          onToggle={(v) => set('minSalary', single(filters.minSalary, v))}
        />
        <p className="filter-hint">{t.filters.minSalaryHint}</p>
      </FilterSection>

      <FilterSection title={t.filters.stack} activeCount={filters.skills.length}>
        <OptionList
          label={t.filters.stack}
          options={skillOptions}
          selected={filters.skills}
          onToggle={(v) => set('skills', toggle(filters.skills, v))}
          searchable
          limit={8}
        />
      </FilterSection>

      <FilterSection title={t.filters.employmentType} activeCount={filters.type.length}>
        <PillGroup
          label={t.filters.employmentType}
          pills={pillsOf(TYPES, t.employmentType)}
          selected={filters.type}
          onToggle={(v) => set('type', toggle(filters.type, v as EmploymentType))}
        />
      </FilterSection>

      <FilterSection title={t.filters.payBand} activeCount={filters.tier.length}>
        <PillGroup
          label={t.filters.payBand}
          pills={TIERS.map((band) => ({
            value: band,
            label: t.payBand[band],
            hint: t.payBandRange[band],
          }))}
          selected={filters.tier}
          onToggle={(v) => set('tier', toggle(filters.tier, v as PayTier))}
        />
        <p className="filter-hint">{t.filters.payBandHint}</p>
      </FilterSection>

      <FilterSection title={t.filters.postedWithin} activeCount={filters.postedWithin ? 1 : 0}>
        <PillGroup
          label={t.filters.postedWithin}
          pills={POSTED_WITHIN_DAYS.map((days) => ({ value: String(days), label: t.filters.postedDays(days) }))}
          selected={filters.postedWithin ? [String(filters.postedWithin)] : []}
          onToggle={(v) => set('postedWithin', single(filters.postedWithin, v))}
        />
      </FilterSection>
    </div>
  );
}
