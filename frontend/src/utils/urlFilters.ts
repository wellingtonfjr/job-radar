import type { JobFilters } from '../types';

export function readFiltersFromUrl(): JobFilters {
  const params = new URLSearchParams(window.location.search);
  return {
    keyword: params.get('keyword') ?? '',
    location: params.get('location') ?? '',
    remoteOnly: params.get('remoteOnly') === 'true',
    source: params.get('source') ?? '',
  };
}

export function writeFiltersToUrl(filters: JobFilters): void {
  const params = new URLSearchParams();
  if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.location.trim()) params.set('location', filters.location.trim());
  if (filters.remoteOnly) params.set('remoteOnly', 'true');
  if (filters.source) params.set('source', filters.source);

  const query = params.toString();
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', newUrl);
}
