import type { ResolverNet } from "./net.js";
import { cleanUrl } from "./postingUrls.js";

/**
 * Remotive's public job page has a plain "Apply for this position" link to
 * the employer. (Other boards hide it behind a click-tracking endpoint,
 * bot protection, or their own application form, so they are not read.)
 */
export async function remotiveApplyLink(net: ResolverNet, listingUrl: string): Promise<string | null> {
  const html = await net.text(listingUrl);
  if (!html) return null;
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,200}?)<\/a>/gi)) {
    const text = (m[2] as string).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/^apply for this position$/i.test(text)) continue;
    const href = (m[1] as string).match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = href ? cleanUrl(href) : null;
    if (url && !/(^|\.)remotive\.(com|io)$/i.test(new URL(url).hostname)) return url;
  }
  return null;
}
