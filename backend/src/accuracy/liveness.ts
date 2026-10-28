import type { Db } from "../db/index.js";
import { recomputeCanonical } from "../ingestion/pipeline.js";
import { mapLimit } from "../sources/http.js";
import { createRefLookup, type RefRow } from "./refs.js";
import { CLOSED_VERDICTS_TO_CLOSE, createVerifier, type AuditNet, type PostingRef, type Verdict } from "./verify.js";

/**
 * Liveness check: closes roles from feeds we can't read in full once the
 * employer's ATS says they're gone, instead of waiting for the stale window.
 *
 * Only absence from a complete feed closes a role at ingestion. Himalayas is
 * never read in full, and Jobicy and Arbeitnow aren't when they hit their page
 * cap, so their roles are re-checked here through the ATS posting their apply
 * link points to, with the audit's verifiers. Roles are taken oldest check
 * first (never-checked first) within a request budget, so the whole set is
 * covered in rotation. A role is closed after CLOSED_VERDICTS_TO_CLOSE
 * consecutive "closed" verdicts; "unknown" changes nothing.
 */

/** Job boards whose feeds may be read only in part. */
export const LIVENESS_SOURCES = ["himalayas", "jobicy", "arbeitnow"];

export const LIVENESS_USER_AGENT = "job-radar-liveness-check (+https://radar-de-vagas.fly.dev)";

export interface LivenessOptions {
  now: Date;
  /** Requests allowed this run (an Ashby board costs one, however many of its roles). */
  budget: number;
  sources?: readonly string[];
  /** Requests in flight at once (per-host spacing is up to the net). */
  concurrency?: number;
}

export interface LivenessSummary {
  checked: number;
  requests: number;
  open: number;
  closed: number;
  unknown: number;
  /** Roles closed by this run (second consecutive "closed"). */
  retired: number;
}

interface Row extends RefRow {
  id: string;
}

/**
 * Requests to spend now: the hourly budget, pro rata to the time since the
 * last check and capped at one hour's worth, so the rate holds whatever the
 * scheduler's tick and however long ingestion delayed this run.
 */
export function livenessBudget(db: Db, now: Date, perHour: number): number {
  if (perHour <= 0) return 0;
  const last = db.prepare("SELECT MAX(last_verified_at) AS at FROM jobs").get() as { at: string | null };
  const hours = last.at ? Math.min(1, Math.max(0, (now.getTime() - Date.parse(last.at)) / 3_600_000)) : 1;
  return Math.floor(perHour * hours);
}

function postingKey(ref: PostingRef): string {
  return `${ref.provider}:${ref.eu ? "eu:" : ""}${ref.board}:${ref.id}`;
}

/** One request per Greenhouse or Lever posting; one per Ashby board. */
function requestKey(ref: PostingRef): string {
  return ref.provider === "ashby" ? `ashby:${ref.board}` : postingKey(ref);
}

export async function runLivenessCheck(db: Db, net: AuditNet, options: LivenessOptions): Promise<LivenessSummary> {
  const { now, budget, sources = LIVENESS_SOURCES, concurrency = 2 } = options;
  const summary: LivenessSummary = { checked: 0, requests: 0, open: 0, closed: 0, unknown: 0, retired: 0 };
  if (budget <= 0 || sources.length === 0) return summary;

  const rows = db
    .prepare(
      `SELECT id, source, feed, external_id, url, apply_url, description_links FROM jobs
       WHERE closed_at IS NULL AND source IN (${sources.map(() => "?").join(", ")})
       ORDER BY last_verified_at, id`,
    )
    .all(...sources) as Row[];

  const refFor = createRefLookup(db);
  const keys = new Set<string>();
  const plan: { id: string; ref: PostingRef }[] = [];
  for (const row of rows) {
    const ref = refFor(row);
    if (!ref) continue;
    const key = requestKey(ref);
    if (!keys.has(key)) {
      if (keys.size >= budget) break;
      keys.add(key);
    }
    plan.push({ id: row.id, ref });
  }
  summary.requests = keys.size;

  // Two rows pointing at the same posting share one request.
  const verify = createVerifier(net);
  const pending = new Map<string, Promise<Verdict>>();
  const verdictOf = (ref: PostingRef): Promise<Verdict> => {
    const key = postingKey(ref);
    let verdict = pending.get(key);
    if (!verdict) {
      verdict = verify(ref).catch((): Verdict => "unknown");
      pending.set(key, verdict);
    }
    return verdict;
  };
  const verdicts = new Map<string, Verdict>();
  await mapLimit(plan, concurrency, async ({ id, ref }) => {
    verdicts.set(id, await verdictOf(ref));
  });

  const nowIso = now.toISOString();
  const markOpen = db.prepare("UPDATE jobs SET last_verified_at = ?, closed_streak = 0 WHERE id = ? AND closed_at IS NULL");
  const markUnknown = db.prepare("UPDATE jobs SET last_verified_at = ? WHERE id = ? AND closed_at IS NULL");
  // Right-hand sides see the row as it was, so closed_streak + 1 is the new streak.
  const markClosed = db.prepare(
    `UPDATE jobs SET last_verified_at = @now, closed_streak = closed_streak + 1,
       closed_at = CASE WHEN closed_streak + 1 >= @strikes THEN @now ELSE NULL END
     WHERE id = @id AND closed_at IS NULL
     RETURNING closed_at`,
  );
  db.transaction(() => {
    for (const [id, verdict] of verdicts) {
      summary.checked += 1;
      summary[verdict] += 1;
      if (verdict === "open") markOpen.run(nowIso, id);
      else if (verdict === "unknown") markUnknown.run(nowIso, id);
      else {
        const row = markClosed.get({ now: nowIso, id, strikes: CLOSED_VERDICTS_TO_CLOSE }) as { closed_at: string | null } | undefined;
        if (row?.closed_at) summary.retired += 1;
      }
    }
    // A closed role may have been hiding another source's copy of it.
    if (summary.retired > 0) recomputeCanonical(db, now);
  })();
  return summary;
}

export function logLiveness(summary: LivenessSummary, budget: number): void {
  console.log(
    `[liveness] checked ${summary.checked} roles with ${summary.requests}/${budget} requests: ` +
      `${summary.open} open, ${summary.closed} closed, ${summary.unknown} unknown · retired ${summary.retired}`,
  );
}
