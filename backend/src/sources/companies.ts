/**
 * Companies read directly from their own applicant-tracking system (ATS).
 * This is the most reliable way to get *real and current* openings: the ATS
 * board is the employer's source of truth, so a job disappears from it the
 * moment it's filled or withdrawn.
 *
 * Every token below was verified to respond with open postings. To add a
 * company, find its public careers URL:
 *   - Greenhouse: boards.greenhouse.io/{token} or job-boards.greenhouse.io/{token}
 *   - Lever:      jobs.lever.co/{token}
 *   - Ashby:      jobs.ashbyhq.com/{token}
 * and add `{ token, name }` to the matching list.
 */
export interface CompanyBoard {
  token: string;
  name: string;
}

export const GREENHOUSE_BOARDS: CompanyBoard[] = [
  { token: "stripe", name: "Stripe" },
  { token: "airbnb", name: "Airbnb" },
  { token: "coinbase", name: "Coinbase" },
  { token: "cloudflare", name: "Cloudflare" },
  { token: "gitlab", name: "GitLab" },
  { token: "elastic", name: "Elastic" },
  { token: "mozilla", name: "Mozilla" },
  { token: "wikimedia", name: "Wikimedia Foundation" },
  { token: "canonical", name: "Canonical" },
  { token: "contentful", name: "Contentful" },
  { token: "wise", name: "Wise" },
  { token: "adyen", name: "Adyen" },
  { token: "typeform", name: "Typeform" },
  { token: "algolia", name: "Algolia" },
  { token: "pandadoc", name: "PandaDoc" },
  { token: "n26", name: "N26" },
  { token: "wolt", name: "Wolt" },
  { token: "gocardless", name: "GoCardless" },
  { token: "truelayer", name: "TrueLayer" },
  { token: "dashlane", name: "Dashlane" },
  { token: "tines", name: "Tines" },
  { token: "ghost", name: "Ghost" },
  { token: "vercel", name: "Vercel" },
  { token: "figma", name: "Figma" },
  { token: "datadog", name: "Datadog" },
  { token: "twilio", name: "Twilio" },
  { token: "airtable", name: "Airtable" },
  { token: "duolingo", name: "Duolingo" },
  { token: "discord", name: "Discord" },
  { token: "grafanalabs", name: "Grafana Labs" },
  { token: "mongodb", name: "MongoDB" },
  { token: "dropbox", name: "Dropbox" },
  { token: "automatticcareers", name: "Automattic" },
  { token: "netlify", name: "Netlify" },
];

export const LEVER_BOARDS: CompanyBoard[] = [
  { token: "palantir", name: "Palantir" },
  { token: "contentsquare", name: "Contentsquare" },
  { token: "qonto", name: "Qonto" },
  { token: "swile", name: "Swile" },
  { token: "aircall", name: "Aircall" },
  { token: "malt", name: "Malt" },
  { token: "spotify", name: "Spotify" },
  { token: "binance", name: "Binance" },
];

export const ASHBY_BOARDS: CompanyBoard[] = [
  { token: "linear", name: "Linear" },
  { token: "ramp", name: "Ramp" },
  { token: "notion", name: "Notion" },
  { token: "supabase", name: "Supabase" },
  { token: "posthog", name: "PostHog" },
  { token: "openai", name: "OpenAI" },
  { token: "replit", name: "Replit" },
  { token: "cursor", name: "Cursor" },
  { token: "zapier", name: "Zapier" },
  { token: "vanta", name: "Vanta" },
  { token: "sentry", name: "Sentry" },
  { token: "1password", name: "1Password" },
];
