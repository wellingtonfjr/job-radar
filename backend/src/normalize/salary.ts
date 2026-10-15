import type { Salary, SalaryPeriod } from "../domain/job.js";

/**
 * Salary handling: parse free-text ranges ("$170k - $200k", "€80,000 –
 * €110,000 per year", "$50-$75 /hour"), validate structured ranges, and
 * produce an approximate annual-USD figure so a "minimum salary" filter can
 * compare postings in different currencies and periods.
 */

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/US\$|USD|\$/i, "USD"],
  [/€|EUR|euros?/i, "EUR"],
  [/£|GBP/i, "GBP"],
  [/CA\$|CAD|C\$/i, "CAD"],
  [/AU\$|AUD|A\$/i, "AUD"],
  [/₹|INR|Rs\.?/i, "INR"],
  [/R\$|BRL/i, "BRL"],
  [/CHF/i, "CHF"],
  [/SEK/i, "SEK"],
  [/PLN|zł/i, "PLN"],
];

// Static, deliberately approximate rates (USD per unit). Only used to rank
// and filter by minimum salary — the original currency is always what's
// displayed, never a converted value.
const USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  INR: 0.012,
  BRL: 0.18,
  CHF: 1.13,
  SEK: 0.095,
  PLN: 0.25,
  NZD: 0.6,
  MXN: 0.055,
  JPY: 0.0067,
  SGD: 0.75,
  DKK: 0.145,
  NOK: 0.093,
};

const PERIODS_PER_YEAR: Record<SalaryPeriod, number> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260,
  hour: 2080,
};

export function normalizePeriod(raw: string | null | undefined): SalaryPeriod | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (/hour|hr|hourly/.test(v)) return "hour";
  if (/day|daily/.test(v)) return "day";
  if (/week/.test(v)) return "week";
  if (/month|mo\b|monthly/.test(v)) return "month";
  if (/year|annual|yr|annum|pa\b/.test(v)) return "year";
  return null;
}

function detectCurrency(text: string): string | null {
  for (const [pattern, code] of CURRENCY_SYMBOLS) {
    if (pattern.test(text)) return code;
  }
  return null;
}

/** "170k" → 170000, "80,000" → 80000, "35,3k" → 35300, "1.5m" → 1500000. */
function parseAmount(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:[.,]\d+)*)\s*([km])?$/i);
  if (!m) return null;
  let digits = m[1] as string;
  const suffix = m[2]?.toLowerCase();
  if (suffix) {
    // With a k/m suffix, a single separator is a decimal point ("35,3k").
    digits = digits.replace(",", ".");
  } else {
    // Without one, separators followed by exactly 3 digits are thousands.
    digits = /[.,]\d{3}(?!\d)/.test(digits) ? digits.replace(/[.,](?=\d{3}(?!\d))/g, "") : digits.replace(",", ".");
  }
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  return suffix === "k" ? value * 1_000 : suffix === "m" ? value * 1_000_000 : value;
}

export function parseSalaryText(text: string | null | undefined): Salary | null {
  if (!text) return null;
  const amounts = [...text.matchAll(/(\d+(?:[.,]\d+)*)\s*([km](?![a-z]))?/gi)]
    .map((m) => parseAmount(`${m[1]}${m[2] ?? ""}`))
    .filter((n): n is number => n !== null && n > 0);
  if (amounts.length === 0) return null;

  // "$170k - $200" style ranges where only one side has the suffix.
  if (amounts.length >= 2 && /k\b/i.test(text)) {
    const [a, b] = amounts as [number, number];
    if (a >= 1000 && b < 1000) amounts[1] = b * 1000;
    if (b >= 1000 && a < 1000) amounts[0] = a * 1000;
  }

  const min = amounts[0] ?? null;
  const max = amounts.length > 1 ? (amounts[1] ?? null) : null;
  let period = normalizePeriod(text);
  if (!period) period = (max ?? min ?? 0) < 300 ? "hour" : "year";

  return validateSalary({ min, max, currency: detectCurrency(text), period });
}

/** Drops nonsensical ranges and orders min/max. */
export function validateSalary(salary: Salary | null | undefined): Salary | null {
  if (!salary) return null;
  let { min, max } = salary;
  if (min !== null && (!Number.isFinite(min) || min <= 0)) min = null;
  if (max !== null && (!Number.isFinite(max) || max <= 0)) max = null;
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { min, max, currency: salary.currency?.toUpperCase() ?? null, period: salary.period };
}

export function annualUsd(salary: Salary | null): number | null {
  if (!salary) return null;
  const base = salary.min ?? salary.max;
  if (base === null) return null;
  // Unknown currency: assume USD, which is what most sources omit it for.
  const rate = USD_PER_UNIT[salary.currency ?? "USD"];
  if (rate === undefined) return null;
  return Math.round(base * PERIODS_PER_YEAR[salary.period] * rate);
}

const CURRENCY_TOKEN = String.raw`(?:US\$|CA\$|AU\$|R\$|\$|€|£|USD|EUR|GBP|CAD|AUD|CHF)`;
const AMOUNT_TOKEN = String.raw`\d{1,3}(?:[.,]\d{3})+(?:\.\d{2})?|\d+(?:[.,]\d+)?\s?[kK]|\d+(?:\.\d{2})?`;
const DESCRIPTION_RANGE = new RegExp(
  String.raw`(${CURRENCY_TOKEN})\s?(${AMOUNT_TOKEN})\s*(?:-|–|—|to)\s*(?:${CURRENCY_TOKEN})?\s?(${AMOUNT_TOKEN})(\s*(?:USD|EUR|GBP|CAD|AUD|CHF))?(\s*(?:per|\/|a|an)\s*(?:year|annum|yr|hour|hr|month))?`,
  "g",
);
const SALARY_CONTEXT = /\b(salary|salaries|compensation|pay|base|OTE|on-target|range|wage|remuneration|earn)\b/i;

/**
 * Many employers (US pay-transparency laws in particular) state the range
 * only inside the description: "The base salary range for this role is
 * $150,000 – $190,000". Only explicit currency ranges preceded by a salary
 * keyword are trusted, and implausible values are rejected.
 */
export function extractSalaryFromDescription(text: string | null | undefined): Salary | null {
  if (!text) return null;
  for (const m of text.matchAll(DESCRIPTION_RANGE)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 200), m.index);
    if (!SALARY_CONTEXT.test(before)) continue;
    const salary = parseSalaryText(m[0]);
    if (!salary || salary.min === null) continue;
    const annual = annualUsd(salary);
    // $10k–$2M per year is the plausible band for a single role.
    if (annual === null || annual < 10_000 || annual > 2_000_000) continue;
    return salary;
  }
  return null;
}
