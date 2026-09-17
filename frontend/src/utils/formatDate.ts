export function formatRelativeDate(iso: string | null): string {
  if (!iso) return 'Unknown date';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  const diffMs = Date.now() - date.getTime();

  // Posted in the future (clock skew, source weirdness) - just show the date.
  if (diffMs < 0) {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;

  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
