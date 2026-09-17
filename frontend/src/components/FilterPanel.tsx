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
}: FilterPanelProps) {
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
            checked={remoteOnly}
            onChange={(e) => onRemoteOnlyChange(e.target.checked)}
          />
          Remote only
        </label>
      </div>
    </form>
  );
}
