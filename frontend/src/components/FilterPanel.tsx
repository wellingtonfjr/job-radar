import { COUNTRIES, countryName } from '../countries';
import { KNOWN_SOURCES } from '../types';

interface FilterPanelProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  location: string;
  onLocationChange: (value: string) => void;
  remoteOnly: boolean;
  onRemoteOnlyChange: (value: boolean) => void;
  source: string;
  onSourceChange: (value: string) => void;
  baseCountries: string[];
  onBaseCountriesChange: (value: string[]) => void;
}

export function FilterPanel({
  keyword,
  onKeywordChange,
  location,
  onLocationChange,
  remoteOnly,
  onRemoteOnlyChange,
  source,
  onSourceChange,
  baseCountries,
  onBaseCountriesChange,
}: FilterPanelProps) {
  const remoteOnlyImplied = baseCountries.length > 0;

  const addBaseCountry = (code: string) => {
    if (!code || baseCountries.includes(code)) return;
    onBaseCountriesChange([...baseCountries, code]);
  };

  const removeBaseCountry = (code: string) => {
    onBaseCountriesChange(baseCountries.filter((c) => c !== code));
  };

  return (
    <form className="filter-panel" onSubmit={(e) => e.preventDefault()}>
      <div className="filter-field">
        <label htmlFor="keyword-filter">Keyword</label>
        <input
          id="keyword-filter"
          type="text"
          placeholder="Title, company, description..."
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
        />
      </div>

      <div className="filter-field">
        <label htmlFor="location-filter">Location</label>
        <input
          id="location-filter"
          type="text"
          placeholder="e.g. Berlin, US..."
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
        />
      </div>

      <div className="filter-field">
        <label htmlFor="source-filter">Source</label>
        <select
          id="source-filter"
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
        >
          <option value="">All sources</option>
          {KNOWN_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-field filter-field-checkbox">
        <label htmlFor="remote-only-filter">
          <input
            id="remote-only-filter"
            type="checkbox"
            checked={remoteOnly || remoteOnlyImplied}
            disabled={remoteOnlyImplied}
            onChange={(e) => onRemoteOnlyChange(e.target.checked)}
          />
          Remote only
        </label>
        {remoteOnlyImplied && <span className="filter-hint">implied by "Based in"</span>}
      </div>

      <div className="filter-field filter-field-wide">
        <label htmlFor="base-country-filter">Based in</label>
        <select
          id="base-country-filter"
          value=""
          onChange={(e) => addBaseCountry(e.target.value)}
        >
          <option value="">Add a country...</option>
          {COUNTRIES.filter((c) => !baseCountries.includes(c.code)).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        {baseCountries.length > 0 && (
          <div className="country-chip-list">
            {baseCountries.map((code) => (
              <span key={code} className="country-chip">
                {countryName(code)}
                <button
                  type="button"
                  className="country-chip-remove"
                  aria-label={`Remove ${countryName(code)}`}
                  onClick={() => removeBaseCountry(code)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <span className="filter-hint">
          Shows remote jobs open to any of these countries, or with no stated restriction.
        </span>
      </div>
    </form>
  );
}
