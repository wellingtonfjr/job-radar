import { createHmac } from "node:crypto";
import type { Db } from "../db/index.js";

/**
 * "Role closed?" reports from visitors.
 *
 * A report never closes a role: it queues a liveness check of the role (see
 * api/reports.ts and liveness.ts), and only the employer's ATS can close it.
 * When the ATS can't answer, the report is kept; a role with REPORTS_TO_HIDE
 * reports from distinct visitors within REPORT_WINDOW_DAYS leaves the default
 * listing (see recomputeCanonical) until the reports expire or a check finds
 * it open, which dismisses them.
 *
 * Visitors are counted by a salted hash of their IP, never the IP itself.
 */

export const REPORTS_TO_HIDE = 3;
export const REPORT_WINDOW_DAYS = 7;

/** A dev-only salt; production sets REPORT_IP_SALT. */
export const DEV_REPORT_IP_SALT = "job-radar-dev-salt";

/** HMAC-SHA256 of the visitor key, so the table can't be reversed to IPs without the salt. */
export function hashIp(ipKey: string, salt: string): string {
  return createHmac("sha256", salt).update(ipKey).digest("hex");
}

export function reportWindowStart(now: Date): string {
  return new Date(now.getTime() - REPORT_WINDOW_DAYS * 86_400_000).toISOString();
}

/**
 * SQL condition (on a `jobs` row) for a role hidden by reports. Takes the
 * named parameters @reportsSince and @reportsToHide.
 */
export const HIDDEN_BY_REPORTS = `(
  SELECT COUNT(DISTINCT r.ip_hash) FROM job_reports r
  WHERE r.job_id = jobs.id AND r.created_at >= @reportsSince AND (r.verdict IS NULL OR r.verdict != 'open')
) >= @reportsToHide`;

export function hiddenByReportsParams(now: Date) {
  return { reportsSince: reportWindowStart(now), reportsToHide: REPORTS_TO_HIDE };
}

export type ReportOutcome = "recorded" | "duplicate";

/**
 * Records a report unless this visitor already reported the role within the
 * window. A role that reaches the threshold leaves the listing right away.
 */
export function recordReport(db: Db, jobId: string, ipHash: string, now: Date): { outcome: ReportOutcome; reportId: number | null } {
  return db.transaction(() => {
    const existing = db
      .prepare("SELECT id FROM job_reports WHERE job_id = ? AND ip_hash = ? AND created_at >= ? LIMIT 1")
      .get(jobId, ipHash, reportWindowStart(now));
    if (existing) return { outcome: "duplicate" as const, reportId: null };
    const reportId = Number(
      db.prepare("INSERT INTO job_reports (job_id, ip_hash, created_at) VALUES (?, ?, ?)").run(jobId, ipHash, now.toISOString()).lastInsertRowid,
    );
    db.prepare(`UPDATE jobs SET canonical = 0 WHERE id = @id AND canonical = 1 AND ${HIDDEN_BY_REPORTS}`).run({
      id: jobId,
      ...hiddenByReportsParams(now),
    });
    return { outcome: "recorded" as const, reportId };
  })();
}

/** Reports per source of the reported role, created at or after `since`. */
export function countReportsBySource(db: Db, since: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT j.source, COUNT(*) AS n FROM job_reports r JOIN jobs j ON j.id = r.job_id
       WHERE r.created_at >= ? GROUP BY j.source`,
    )
    .all(since) as { source: string; n: number }[];
  return new Map(rows.map((r) => [r.source, r.n]));
}
