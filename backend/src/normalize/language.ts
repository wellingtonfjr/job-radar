/**
 * Rough language detection by stopword counts — enough to tell an English
 * posting from a Dutch, German or French one, not a general-purpose detector.
 * Common words shared by several of these languages ("de", "en", "die",
 * "que", "para", "la", "is") are left out, and ones like "du" or "das" count
 * for one language only, so each hit is a real vote.
 */
export type Language = "en" | "de" | "nl" | "fr" | "es" | "pt";

const STOPWORDS: Record<Language, readonly string[]> = {
  en: ["the", "and", "with", "you", "your", "our", "we", "are", "will", "this", "that", "for", "of", "to", "be", "have", "who", "from"],
  de: ["und", "der", "mit", "für", "wir", "sie", "ist", "ein", "eine", "zu", "von", "bei", "auf", "den", "dem", "ihre", "unser", "unsere", "oder", "nicht", "auch", "sich", "dich", "dein", "deine"],
  nl: ["het", "een", "van", "voor", "met", "wij", "jij", "jouw", "zijn", "bij", "ons", "onze", "naar", "ook", "niet", "wat", "deze", "heb", "hebt", "je", "op"],
  fr: ["le", "les", "et", "des", "du", "pour", "avec", "vous", "nous", "une", "est", "dans", "sur", "au", "votre", "notre", "sont", "qui"],
  es: ["el", "los", "las", "y", "con", "una", "del", "por", "nuestro", "nuestra", "somos", "tus", "sus", "puesto"],
  pt: ["os", "e", "com", "uma", "da", "dos", "das", "na", "em", "você", "nosso", "nossa", "não", "são", "vaga"],
};

const LOOKUP = new Map<string, Language>();
for (const [lang, words] of Object.entries(STOPWORDS) as [Language, readonly string[]][]) {
  for (const word of words) LOOKUP.set(word, lang);
}

/** Below this many stopword hits the text is too short to call. */
const MIN_HITS = 5;
/** Only the start is read: long postings sometimes append an English legal footer. */
const MAX_WORDS = 400;

/** The most likely language of `text`, or `null` when there's too little to tell. */
export function detectLanguage(text: string | null | undefined): Language | null {
  if (!text) return null;
  const words = text.toLowerCase().match(/\p{L}+/gu)?.slice(0, MAX_WORDS) ?? [];
  const counts = new Map<Language, number>();
  for (const word of words) {
    const lang = LOOKUP.get(word);
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  let best: Language | null = null;
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) [best, bestCount] = [lang, count];
  }
  return bestCount >= MIN_HITS ? best : null;
}
