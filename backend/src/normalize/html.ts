/**
 * Dependency-free HTML-to-text conversion for job descriptions. We store and
 * serve plain text (with paragraph and bullet structure preserved) instead of
 * HTML, so the frontend never has to render untrusted markup.
 *
 * Some sources (observed on Greenhouse) entity-encode the HTML itself
 * (`&lt;p&gt;...`), so entities are decoded once before stripping tags and
 * again afterwards.
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  middot: "·",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  ordm: "º",
  ordf: "ª",
  deg: "°",
  laquo: "«",
  raquo: "»",
  iexcl: "¡",
  iquest: "¿",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  times: "×",
  sup2: "²",
  sup3: "³",
  frac12: "½",
  shy: "",
  zwj: "",
  zwnj: "",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  acute: "´",
  rarr: "→",
  larr: "←",
  harr: "↔",
  uarr: "↑",
  darr: "↓",
  rArr: "⇒",
  le: "≤",
  ge: "≥",
  ne: "≠",
  plusmn: "±",
  divide: "÷",
  check: "✓",
  hearts: "♥",
  star: "☆",
};

// Greek letters (&alpha; … &Omega;), common in data/science postings.
const GREEK = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(" ");
GREEK.forEach((name, i) => {
  const lower = String.fromCodePoint(0x3b1 + i + (i >= 17 ? 1 : 0)); // skip final sigma (ς)
  NAMED_ENTITIES[name] = lower;
  NAMED_ENTITIES[name[0]!.toUpperCase() + name.slice(1)] = lower.toUpperCase();
});

// Accented letters (&eacute; &atilde; &ccedil; &Ecirc; …), generated rather
// than listed: Portuguese/Spanish/French job descriptions use all of them.
const DIACRITICS: Record<string, string> = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  tilde: "\u0303",
  uml: "\u0308",
  ring: "\u030a",
  cedil: "\u0327",
};
for (const letter of "aeiouyncAEIOUYNC") {
  for (const [suffix, mark] of Object.entries(DIACRITICS)) {
    const composed = `${letter}${mark}`.normalize("NFC");
    // Only real precomposed letters (e.g. "ç", not "c" + loose mark).
    if (composed.length === 1) NAMED_ENTITIES[`${letter}${suffix}`] = composed;
  }
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    // Entity names are case-sensitive (&Eacute; ≠ &eacute;); fall back to
    // lowercase for sloppy markup like &NBSP;.
    return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const BLOCK_TAGS = "p|div|section|article|header|footer|h[1-6]|ul|ol|table|tr|blockquote|pre";

export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  let text = html;
  if (/&lt;\/?[a-z]/i.test(text)) text = decodeEntities(text);

  text = text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(new RegExp(`</?(${BLOCK_TAGS})(\\s[^>]*)?>`, "gi"), "\n\n")
    .replace(/<[^>]*>/g, "");

  text = decodeEntities(text)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // A bullet directly after a paragraph break reads better without the gap.
    .replace(/\n\n•/g, "\n•")
    .trim();

  return text.length > 0 ? text : null;
}

/** Collapses a plain-text description from a source into the same shape. */
export function cleanText(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
