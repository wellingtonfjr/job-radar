import type { Db } from "../db/index.js";
import { parsePostingRef, refFromAtsRow, type PostingRef } from "./verify.js";

/** The job columns a posting ref is derived from. */
export interface RefRow {
  source: string;
  feed: string;
  external_id: string;
  url: string;
  apply_url: string | null;
  description_links: string;
}

const ATS_SOURCES = ["greenhouse", "lever", "ashby"];

/**
 * Maps a stored role to the ATS posting it can be checked through, or null.
 * ATS rows are checked by their own board and id; job-board rows through
 * their resolved apply link, then any posting link in the description or URL.
 */
export function createRefLookup(db: Db): (row: RefRow) => PostingRef | null {
  const atsRowByUrl = db.prepare(
    `SELECT source, feed, external_id FROM jobs WHERE url = ? AND source IN (${ATS_SOURCES.map(() => "?").join(", ")}) LIMIT 1`,
  );

  return (row) => {
    const own = refFromAtsRow(row.source, row.feed, row.external_id);
    if (own) return own;
    const fromApply = parsePostingRef(row.apply_url);
    if (fromApply) return fromApply;
    // An "ats-match" apply link is the URL of a row we ingest from the ATS
    // (sometimes on the employer's own domain), so its board and id are known.
    if (row.apply_url) {
      const ats = atsRowByUrl.get(row.apply_url, ...ATS_SOURCES) as { source: string; feed: string; external_id: string } | undefined;
      if (ats) return refFromAtsRow(ats.source, ats.feed, ats.external_id);
    }
    for (const link of [...(JSON.parse(row.description_links) as string[]), row.url]) {
      const ref = parsePostingRef(link);
      if (ref) return ref;
    }
    return null;
  };
}
