/**
 * Best-effort parser that turns a free-text location string (as given by
 * wildly inconsistent source APIs) into a list of ISO 3166-1 alpha-2 country
 * codes a remote posting is restricted to, or `null` when no restriction is
 * detected — which we treat as "open to anyone" per product decision: if a
 * source doesn't say a country is required, we don't exclude it.
 *
 * This is necessarily approximate. It only recognizes country/region names
 * it's told about below; an unrecognized city name or ambiguous phrase falls
 * back to `null` (unrestricted) rather than guessing wrong.
 */

const COUNTRY_ALIASES: Record<string, string> = {
  "UNITED STATES OF AMERICA": "US",
  "UNITED STATES": "US",
  "USA": "US",
  "U.S.A": "US",
  "U.S": "US",
  "US": "US",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  "U.K": "GB",
  "UK": "GB",
  "ENGLAND": "GB",
  "SCOTLAND": "GB",
  "WALES": "GB",
  "CANADA": "CA",
  "MEXICO": "MX",
  "BRAZIL": "BR",
  "BRASIL": "BR",
  "ARGENTINA": "AR",
  "CHILE": "CL",
  "COLOMBIA": "CO",
  "PERU": "PE",
  "URUGUAY": "UY",
  "ECUADOR": "EC",
  "PORTUGAL": "PT",
  "SPAIN": "ES",
  "FRANCE": "FR",
  "GERMANY": "DE",
  "ITALY": "IT",
  "THE NETHERLANDS": "NL",
  "NETHERLANDS": "NL",
  "HOLLAND": "NL",
  "IRELAND": "IE",
  "POLAND": "PL",
  "SWEDEN": "SE",
  "NORWAY": "NO",
  "DENMARK": "DK",
  "FINLAND": "FI",
  "SWITZERLAND": "CH",
  "AUSTRIA": "AT",
  "BELGIUM": "BE",
  "CZECH REPUBLIC": "CZ",
  "CZECHIA": "CZ",
  "ROMANIA": "RO",
  "GREECE": "GR",
  "HUNGARY": "HU",
  "BULGARIA": "BG",
  "CROATIA": "HR",
  "SERBIA": "RS",
  "SLOVENIA": "SI",
  "SLOVAKIA": "SK",
  "ESTONIA": "EE",
  "LATVIA": "LV",
  "LITHUANIA": "LT",
  "ICELAND": "IS",
  "LUXEMBOURG": "LU",
  "CYPRUS": "CY",
  "MALTA": "MT",
  "UKRAINE": "UA",
  "RUSSIA": "RU",
  "TURKEY": "TR",
  "ISRAEL": "IL",
  "UNITED ARAB EMIRATES": "AE",
  "UAE": "AE",
  "SAUDI ARABIA": "SA",
  "SOUTH AFRICA": "ZA",
  "NIGERIA": "NG",
  "KENYA": "KE",
  "EGYPT": "EG",
  "MOROCCO": "MA",
  "INDIA": "IN",
  "CHINA": "CN",
  "JAPAN": "JP",
  "SOUTH KOREA": "KR",
  "SINGAPORE": "SG",
  "PHILIPPINES": "PH",
  "INDONESIA": "ID",
  "VIETNAM": "VN",
  "THAILAND": "TH",
  "MALAYSIA": "MY",
  "AUSTRALIA": "AU",
  "NEW ZEALAND": "NZ",
};

const EUROPE_CODES = [
  "PT", "ES", "FR", "DE", "IT", "NL", "IE", "PL", "SE", "NO", "DK", "FI",
  "CH", "AT", "BE", "CZ", "RO", "GR", "HU", "UA", "GB", "BG", "HR", "RS",
  "SI", "SK", "EE", "LV", "LT", "IS", "LU", "CY", "MT",
];
const LATAM_CODES = ["BR", "MX", "AR", "CL", "CO", "PE", "UY", "EC"];
const NORTH_AMERICA_CODES = ["US", "CA", "MX"];
const APAC_CODES = ["IN", "CN", "JP", "KR", "SG", "PH", "ID", "VN", "TH", "MY", "AU", "NZ"];
const AFRICA_CODES = ["ZA", "NG", "KE", "EG", "MA"];
const MIDDLE_EAST_CODES = ["AE", "SA", "IL", "TR"];

const REGION_ALIASES: Record<string, string[]> = {
  EUROPE: EUROPE_CODES,
  EU: EUROPE_CODES,
  EMEA: [...EUROPE_CODES, ...MIDDLE_EAST_CODES, ...AFRICA_CODES],
  LATAM: LATAM_CODES,
  "LATIN AMERICA": LATAM_CODES,
  "SOUTH AMERICA": LATAM_CODES,
  "NORTH AMERICA": NORTH_AMERICA_CODES,
  AMERICAS: [...NORTH_AMERICA_CODES, ...LATAM_CODES],
  APAC: APAC_CODES,
  "ASIA PACIFIC": APAC_CODES,
  ASIA: APAC_CODES,
  AFRICA: AFRICA_CODES,
  "MIDDLE EAST": MIDDLE_EAST_CODES,
};

const UNRESTRICTED_PATTERN =
  /\b(WORLDWIDE|ANYWHERE|GLOBAL|INTERNATIONAL|NO RESTRICTIONS?|ANY LOCATION)\b/;

// Longest alias first so multi-word names aren't shadowed by a shorter
// substring alias when building the combined regex.
const COUNTRY_ENTRIES = Object.entries(COUNTRY_ALIASES).sort((a, b) => b[0].length - a[0].length);
const REGION_ENTRIES = Object.entries(REGION_ALIASES).sort((a, b) => b[0].length - a[0].length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(rawLocation: string): string {
  return ` ${rawLocation.toUpperCase().replace(/[.,()/-]/g, " ")} `;
}

export function parseAllowedCountries(rawLocation: string | null | undefined): string[] | null {
  if (!rawLocation || rawLocation.trim() === "") return null;

  const text = normalize(rawLocation);

  if (UNRESTRICTED_PATTERN.test(text)) return null;

  const matched = new Set<string>();

  // A location string commonly mixes both ("Americas, Europe, Israel"), so
  // both passes always run and their matches are unioned — narrowing to
  // "only countries" whenever any country matched would silently drop the
  // region matches sitting right next to it.
  for (const [alias, code] of COUNTRY_ENTRIES) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(text)) {
      matched.add(code);
    }
  }

  for (const [alias, codes] of REGION_ENTRIES) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(text)) {
      codes.forEach((c) => matched.add(c));
    }
  }

  return matched.size > 0 ? Array.from(matched).sort() : null;
}
