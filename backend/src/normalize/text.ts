/**
 * Spelling-insensitive key for search: lowercase, no accents, and no
 * spaces/hyphens/dots/slashes, so "Front End", "front-end" and "Frontend"
 * (or "Next.js" / "nextjs") all compare equal.
 */
export function toSearchKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s\-_./]+/g, "");
}
