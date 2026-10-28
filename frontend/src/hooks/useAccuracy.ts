import { useEffect, useState } from 'react';
import { fetchAccuracy } from '../api/client';
import type { Accuracy } from '../api/types';

/** The latest accuracy audit, for the footer's trust signal. Failure is non-fatal. */
export function useAccuracy(): Accuracy | null {
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAccuracy(controller.signal)
      .then(setAccuracy)
      .catch(() => {
        // The footer just leaves the metric out.
      });
    return () => controller.abort();
  }, []);

  return accuracy;
}
