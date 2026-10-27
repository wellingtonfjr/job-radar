import { useEffect, useState } from 'react';
import { fetchStats } from '../api/client';
import type { Stats } from '../api/types';

/** Headline numbers, facet options and source health. Failure is non-fatal. */
export function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchStats(controller.signal)
      .then(setStats)
      .catch(() => {
        // The listing still works without stats; counts just stay hidden.
      });
    return () => controller.abort();
  }, []);

  return stats;
}
