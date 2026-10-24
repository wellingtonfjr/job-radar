import { decodeEntities } from "./html.js";

/**
 * Makes a URL from an external source safe to store and render as a link
 * or image: only web addresses survive. Anything else — `javascript:`,
 * `data:`, `vbscript:`, relative paths, garbage — returns `null`, so a
 * compromised or buggy source can't inject script through an Apply button.
 *
 * `http:` is upgraded to `https:` by default: the site itself is served
 * over HTTPS (an `http:` image would be blocked as mixed content) and
 * virtually every job site supports it. Pass `upgradeHttp: false` to
 * reject `http:` instead.
 */
export function safeUrl(raw: string | null | undefined, { upgradeHttp = true } = {}): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(decodeEntities(raw.trim()));
  } catch {
    return null;
  }
  if (url.protocol === "http:" && upgradeHttp) url.protocol = "https:";
  if (url.protocol !== "https:") return null;
  // "https://user:pass@host" is a classic phishing disguise; never keep it.
  url.username = "";
  url.password = "";
  return url.toString();
}
