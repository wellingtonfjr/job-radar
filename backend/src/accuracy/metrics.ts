import type { Verdict } from "./verify.js";

export interface VerdictCounts {
  sampled: number;
  open: number;
  closed: number;
  unknown: number;
}

export function countVerdicts(verdicts: readonly Verdict[]): VerdictCounts {
  const counts: VerdictCounts = { sampled: verdicts.length, open: 0, closed: 0, unknown: 0 };
  for (const v of verdicts) counts[v] += 1;
  return counts;
}

/** part / whole, or null when nothing was measured (never a fake 0% or 100%). */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Nearest-rank percentile (p in 0..100) of unsorted values; null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

/**
 * Open precision: of the roles we show as open that the ATS could answer
 * for, the share that really are open. Unknowns are left out, not counted
 * as open.
 */
export function openPrecision(c: VerdictCounts): number | null {
  return ratio(c.open, c.open + c.closed);
}

/** False closures: of the roles we recently closed that the ATS could answer for, the share still open there. */
export function falseClosureRate(c: VerdictCounts): number | null {
  return ratio(c.open, c.open + c.closed);
}

/** Coverage: the share of sampled roles (open and closed samples together) that could be verified at all. */
export function coverage(open: VerdictCounts, closed: VerdictCounts): number | null {
  return ratio(open.open + open.closed + closed.open + closed.closed, open.sampled + closed.sampled);
}

/** Hours between two ISO timestamps. */
export function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
}
