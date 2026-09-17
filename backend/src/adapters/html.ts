/**
 * Small dependency-free HTML-to-text helper shared by adapters whose source
 * APIs return job descriptions as HTML (Greenhouse, Arbeitnow) or as HTML
 * that may itself be entity-encoded (observed on some Greenhouse boards,
 * where `content` comes back as `&lt;h2&gt;...&lt;/h2&gt;` instead of
 * `<h2>...</h2>`). We decode entities twice to cover both cases, then strip
 * tags and collapse whitespace.
 */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntitiesOnce(input: string): string {
  return input.replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (match) => ENTITIES[match] ?? match);
}

export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  let text = html;
  text = decodeEntitiesOnce(text);
  text = decodeEntitiesOnce(text);
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}
