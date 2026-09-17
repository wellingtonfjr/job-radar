import type { JobFilters } from '../types';

export function readFiltersFromUrl(): JobFilters {
  const params = new URLSearchParams(window.location.search);
  const baseCountriesParam = params.get('baseCountries');
  return {
    keyword: params.get('keyword') ?? '',
    location: params.get('location') ?? '',
    remoteOnly: params.get('remoteOnly') === 'true',
    source: params.get('source') ?? '',
    baseCountries: baseCountriesParam
      ? baseCountriesParam.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
      : [],
  };
}

export function writeFiltersToUrl(filters: JobFilters): void {
  const params = new URLSearchParams();
  if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.location.trim()) params.set('location', filters.location.trim());
  if (filters.remoteOnly) params.set('remoteOnly', 'true');
  if (filters.source) params.set('source', filters.source);
  if (filters.baseCountries.length > 0) params.set('baseCountries', filters.baseCountries.join(','));

  const query = params.toString();
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', newUrl);
}
