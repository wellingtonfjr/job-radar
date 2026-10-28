import type { Workplace } from "../domain/job.js";

/**
 * Best-effort parsing of free-text locations ("Remote - EMEA", "Berlin,
 * Germany", "San Francisco, CA", "Americas, Europe, Israel") into the set of
 * ISO 3166-1 alpha-2 countries a job is open to.
 *
 * Returns `null` when no restriction is detected. For a remote posting that
 * means "open to anyone"; for an on-site posting it means "location unknown".
 * Unrecognized place names fall back to `null` rather than a wrong guess.
 */

const COUNTRY_ALIASES: Record<string, string> = {
  "UNITED STATES OF AMERICA": "US",
  "UNITED STATES": "US",
  USA: "US",
  "U S A": "US",
  "U S": "US",
  US: "US",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  "U K": "GB",
  UK: "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  "NORTHERN IRELAND": "GB",
  CANADA: "CA",
  MEXICO: "MX",
  BRAZIL: "BR",
  BRASIL: "BR",
  ARGENTINA: "AR",
  CHILE: "CL",
  COLOMBIA: "CO",
  PERU: "PE",
  URUGUAY: "UY",
  PARAGUAY: "PY",
  BOLIVIA: "BO",
  ECUADOR: "EC",
  VENEZUELA: "VE",
  "COSTA RICA": "CR",
  GUATEMALA: "GT",
  PANAMA: "PA",
  "DOMINICAN REPUBLIC": "DO",
  "PUERTO RICO": "PR",
  JAMAICA: "JM",
  PORTUGAL: "PT",
  SPAIN: "ES",
  FRANCE: "FR",
  GERMANY: "DE",
  DEUTSCHLAND: "DE",
  ITALY: "IT",
  "THE NETHERLANDS": "NL",
  NETHERLANDS: "NL",
  HOLLAND: "NL",
  IRELAND: "IE",
  POLAND: "PL",
  SWEDEN: "SE",
  NORWAY: "NO",
  DENMARK: "DK",
  FINLAND: "FI",
  SWITZERLAND: "CH",
  AUSTRIA: "AT",
  BELGIUM: "BE",
  "CZECH REPUBLIC": "CZ",
  CZECHIA: "CZ",
  ROMANIA: "RO",
  GREECE: "GR",
  HUNGARY: "HU",
  BULGARIA: "BG",
  CROATIA: "HR",
  SERBIA: "RS",
  SLOVENIA: "SI",
  SLOVAKIA: "SK",
  ESTONIA: "EE",
  LATVIA: "LV",
  LITHUANIA: "LT",
  ICELAND: "IS",
  LUXEMBOURG: "LU",
  CYPRUS: "CY",
  MALTA: "MT",
  ALBANIA: "AL",
  "BOSNIA AND HERZEGOVINA": "BA",
  BOSNIA: "BA",
  MONTENEGRO: "ME",
  "NORTH MACEDONIA": "MK",
  MOLDOVA: "MD",
  UKRAINE: "UA",
  BELARUS: "BY",
  RUSSIA: "RU",
  ARMENIA: "AM",
  KAZAKHSTAN: "KZ",
  TURKEY: "TR",
  TURKIYE: "TR",
  ISRAEL: "IL",
  "UNITED ARAB EMIRATES": "AE",
  UAE: "AE",
  "SAUDI ARABIA": "SA",
  QATAR: "QA",
  "SOUTH AFRICA": "ZA",
  NIGERIA: "NG",
  KENYA: "KE",
  GHANA: "GH",
  EGYPT: "EG",
  MOROCCO: "MA",
  TUNISIA: "TN",
  INDIA: "IN",
  PAKISTAN: "PK",
  BANGLADESH: "BD",
  "SRI LANKA": "LK",
  NEPAL: "NP",
  CHINA: "CN",
  "HONG KONG": "HK",
  TAIWAN: "TW",
  JAPAN: "JP",
  "SOUTH KOREA": "KR",
  KOREA: "KR",
  SINGAPORE: "SG",
  PHILIPPINES: "PH",
  INDONESIA: "ID",
  VIETNAM: "VN",
  "VIET NAM": "VN",
  THAILAND: "TH",
  MALAYSIA: "MY",
  AUSTRALIA: "AU",
  "NEW ZEALAND": "NZ",
};

/**
 * Major hiring cities, so on-site postings that only name a city
 * ("San Francisco, CA", "London") still get a country.
 */
const CITY_ALIASES: Record<string, string> = {
  "SAN FRANCISCO": "US",
  "NEW YORK": "US",
  NYC: "US",
  SEATTLE: "US",
  AUSTIN: "US",
  BOSTON: "US",
  CHICAGO: "US",
  "LOS ANGELES": "US",
  DENVER: "US",
  "WASHINGTON DC": "US",
  // "Washington, D.C." after punctuation is stripped.
  "WASHINGTON D C": "US",
  "SAN DIEGO": "US",
  ATLANTA: "US",
  MIAMI: "US",
  TORONTO: "CA",
  VANCOUVER: "CA",
  MONTREAL: "CA",
  LONDON: "GB",
  MANCHESTER: "GB",
  EDINBURGH: "GB",
  DUBLIN: "IE",
  BERLIN: "DE",
  MUNICH: "DE",
  "MÜNCHEN": "DE",
  HAMBURG: "DE",
  FRANKFURT: "DE",
  COLOGNE: "DE",
  PARIS: "FR",
  LYON: "FR",
  AMSTERDAM: "NL",
  ROTTERDAM: "NL",
  MADRID: "ES",
  BARCELONA: "ES",
  LISBON: "PT",
  PORTO: "PT",
  MILAN: "IT",
  ROME: "IT",
  WARSAW: "PL",
  KRAKOW: "PL",
  PRAGUE: "CZ",
  VIENNA: "AT",
  ZURICH: "CH",
  GENEVA: "CH",
  STOCKHOLM: "SE",
  COPENHAGEN: "DK",
  OSLO: "NO",
  HELSINKI: "FI",
  BRUSSELS: "BE",
  BUCHAREST: "RO",
  BUDAPEST: "HU",
  ATHENS: "GR",
  "TEL AVIV": "IL",
  DUBAI: "AE",
  BANGALORE: "IN",
  BENGALURU: "IN",
  HYDERABAD: "IN",
  PUNE: "IN",
  MUMBAI: "IN",
  "NEW DELHI": "IN",
  TOKYO: "JP",
  SEOUL: "KR",
  SYDNEY: "AU",
  MELBOURNE: "AU",
  AUCKLAND: "NZ",
  "SAO PAULO": "BR",
  "SÃO PAULO": "BR",
  "RIO DE JANEIRO": "BR",
  "BELO HORIZONTE": "BR",
  "CURITIBA": "BR",
  "PORTO ALEGRE": "BR",
  "FLORIANOPOLIS": "BR",
  "FLORIANÓPOLIS": "BR",
  "RECIFE": "BR",
  "BRASILIA": "BR",
  "BRASÍLIA": "BR",
  "CAMPINAS": "BR",
  "MEXICO CITY": "MX",
  "BUENOS AIRES": "AR",
  BOGOTA: "CO",
  "BOGOTÁ": "CO",
  SANTIAGO: "CL",
};

/** Two-letter US state codes as used in "City, ST" strings. */
const US_STATE_CODES = new Set(
  (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK " +
    "OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC"
  ).split(" ")
);

const EUROPE = [
  "PT", "ES", "FR", "DE", "IT", "NL", "IE", "PL", "SE", "NO", "DK", "FI", "CH", "AT", "BE", "CZ", "RO",
  "GR", "HU", "UA", "GB", "BG", "HR", "RS", "SI", "SK", "EE", "LV", "LT", "IS", "LU", "CY", "MT", "AL",
  "BA", "ME", "MK", "MD",
];
const EU_MEMBERS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];
const WESTERN_EUROPE = ["PT", "ES", "FR", "DE", "IT", "NL", "IE", "GB", "CH", "AT", "BE", "LU", "DK", "SE", "NO", "FI", "IS", "MT", "CY"];
const EASTERN_EUROPE = ["PL", "CZ", "SK", "HU", "RO", "BG", "UA", "MD", "EE", "LV", "LT", "HR", "RS", "SI", "BA", "ME", "MK", "AL", "GR"];
const LATAM = ["BR", "MX", "AR", "CL", "CO", "PE", "UY", "PY", "BO", "EC", "VE", "CR", "GT", "PA", "DO", "PR", "JM"];
const NORTH_AMERICA = ["US", "CA"];
const APAC = ["IN", "PK", "BD", "LK", "NP", "CN", "HK", "TW", "JP", "KR", "SG", "PH", "ID", "VN", "TH", "MY", "AU", "NZ"];
const AFRICA = ["ZA", "NG", "KE", "GH", "EG", "MA", "TN"];
const MIDDLE_EAST = ["AE", "SA", "QA", "IL", "TR"];

const REGION_ALIASES: Record<string, string[]> = {
  EUROPE: EUROPE,
  "EUROPEAN UNION": EU_MEMBERS,
  EU: EU_MEMBERS,
  EEA: [...EU_MEMBERS, "IS", "NO"],
  "WESTERN EUROPE": WESTERN_EUROPE,
  "EASTERN EUROPE": EASTERN_EUROPE,
  "CENTRAL EUROPE": ["DE", "AT", "CH", "PL", "CZ", "SK", "HU", "SI"],
  NORDICS: ["SE", "NO", "DK", "FI", "IS"],
  DACH: ["DE", "AT", "CH"],
  BENELUX: ["BE", "NL", "LU"],
  EMEA: [...EUROPE, ...MIDDLE_EAST, ...AFRICA],
  LATAM: LATAM,
  "LATIN AMERICA": LATAM,
  "SOUTH AMERICA": ["BR", "AR", "CL", "CO", "PE", "UY", "PY", "BO", "EC", "VE"],
  "CENTRAL AMERICA": ["MX", "CR", "GT", "PA"],
  "NORTH AMERICA": NORTH_AMERICA,
  "NORTHERN AMERICA": NORTH_AMERICA,
  AMERICAS: [...NORTH_AMERICA, ...LATAM],
  APAC: APAC,
  "ASIA PACIFIC": APAC,
  ASIA: APAC,
  OCEANIA: ["AU", "NZ"],
  ANZ: ["AU", "NZ"],
  AFRICA: AFRICA,
  "MIDDLE EAST": MIDDLE_EAST,
  MENA: [...MIDDLE_EAST, "EG", "MA", "TN"],
};

const UNRESTRICTED_PATTERN = /\b(WORLDWIDE|ANYWHERE|GLOBAL|GLOBALLY|INTERNATIONAL|NO RESTRICTIONS?|ANY LOCATION|EVERYWHERE)\b/;
// English plus Portuguese/Spanish ("remoto", "home office", "teletrabalho", "híbrido").
const REMOTE_PATTERN = /\b(remote|anywhere|worldwide|work from home|wfh|distributed|home[- ]based|telecommute|remoto|home office|teletrabalho)\b/i;
const HYBRID_PATTERN = /\b(hybrid|h[íi]brido)\b/i;
/**
 * A location that only names a work mode ("Hybrid", "Remote", "On-site",
 * "(Remoto)"), not a place.
 */
const WORK_MODE_ONLY =
  /^[\s()[\]\-–—,/|]*(?:(?:fully|100%)\s+)?(?:remote|hybrid|on-?site|in[- ]office|office[- ]based|remote[- ]first|flexible|remoto|h[íi]brido|presencial|home office)(?:\s+(?:jobs?|work|working|only|first))?[\s()[\]\-–—,/|]*$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest alias first so "UNITED STATES" wins over "US" in the alternation. */
function buildMatcher(aliases: string[]): RegExp {
  const alternation = [...aliases]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(`(?<![A-ZÀ-Þ])(${alternation})(?![A-ZÀ-Þ])`, "g");
}

const COUNTRY_MATCHER = buildMatcher(Object.keys(COUNTRY_ALIASES));
const CITY_MATCHER = buildMatcher(Object.keys(CITY_ALIASES));
const REGION_MATCHER = buildMatcher(Object.keys(REGION_ALIASES));
const STATE_SUFFIX = /,\s*([A-Z]{2})\b(?!\s*[A-Za-z])/g;

function normalizeText(raw: string): string {
  return ` ${raw.toUpperCase().replace(/[.,()/|;:\-–—_+]/g, " ").replace(/\s+/g, " ")} `;
}

/** Countries named in a single location string (empty when none recognized). */
function countriesIn(raw: string): Set<string> {
  const text = normalizeText(raw);
  const found = new Set<string>();
  for (const m of text.matchAll(COUNTRY_MATCHER)) {
    const code = COUNTRY_ALIASES[m[1] as string];
    if (code) found.add(code);
  }
  for (const m of text.matchAll(REGION_MATCHER)) {
    REGION_ALIASES[m[1] as string]?.forEach((c) => found.add(c));
  }
  for (const m of text.matchAll(CITY_MATCHER)) {
    const code = CITY_ALIASES[m[1] as string];
    if (code) found.add(code);
  }
  // "Austin, TX" — only trusted when the original string uses that format
  // and names no other country: Brazilian state codes collide with US ones
  // ("Joinville, SC, Brazil", "Belém, PA, Brazil").
  if (found.size === 0) {
    for (const m of raw.matchAll(STATE_SUFFIX)) {
      if (US_STATE_CODES.has(m[1] as string)) found.add("US");
    }
  }
  return found;
}

export function parseAllowedCountries(locations: readonly (string | null | undefined)[]): string[] | null {
  const union = new Set<string>();
  for (const raw of locations) {
    if (!raw || raw.trim() === "") continue;
    const found = countriesIn(raw);
    // "Worldwide" alongside other entries means the job is open to anyone,
    // but "Anywhere in Europe" is still a Europe restriction.
    if (found.size === 0 && UNRESTRICTED_PATTERN.test(normalizeText(raw))) return null;
    found.forEach((c) => union.add(c));
  }
  return union.size > 0 ? Array.from(union).sort() : null;
}

/**
 * Remote / hybrid / on-site. An explicit value from the source wins, except
 * that a "hybrid" mention upgrades a source's generic non-remote flag.
 * Without any signal, a posting with a physical location is on-site.
 */
export function inferWorkplace(explicit: Workplace | null, locations: readonly string[], title: string): Workplace {
  const texts = [...locations, title];
  if (explicit === "remote" || explicit === "hybrid") return explicit;
  if (texts.some((t) => HYBRID_PATTERN.test(t))) return "hybrid";
  if (explicit === "onsite") return "onsite";
  if (texts.some((t) => REMOTE_PATTERN.test(t))) return "remote";
  return "onsite";
}

/**
 * Drops entries that only name a work mode, so "Hybrid" isn't listed (or
 * read) as a place. Run after `inferWorkplace`, which still needs them.
 */
export function withoutWorkModes(locations: readonly string[]): string[] {
  return locations.filter((l) => !WORK_MODE_ONLY.test(l));
}

/** Splits a source's single free-text location field into display parts. */
export function splitLocations(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  // Only split on separators that unambiguously join *alternative*
  // locations; commas usually join city/state/country of one location.
  const parts = trimmed
    .split(/\s*(?:;|\||\s\/\s|\bor\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}
