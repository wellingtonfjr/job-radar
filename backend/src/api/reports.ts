import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { checkRole } from "../accuracy/liveness.js";
import { DEV_REPORT_IP_SALT, hashIp, recordReport } from "../accuracy/reports.js";
import type { AuditNet } from "../accuracy/verify.js";
import { DEFAULT_REPORTS_PER_HOUR } from "../config.js";
import type { Db } from "../db/index.js";

/** Roles waiting for a check at most; reports beyond it are still recorded. */
const MAX_PENDING_CHECKS = 100;

export interface ReportQueue {
  /** Queues a check of the role (once, however many reports arrive meanwhile). */
  enqueue(jobId: string): void;
  /** Resolves when every queued check is done. */
  idle(): Promise<void>;
}

/**
 * Checks reported roles one at a time, in the background, so a burst of
 * reports turns into at most one ATS request each, spaced by the net.
 */
export function createReportQueue(db: Db, net: AuditNet, now: () => Date = () => new Date()): ReportQueue {
  const pending = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  const setVerdict = db.prepare("UPDATE job_reports SET verdict = ? WHERE job_id = ? AND verdict IS NULL");

  const check = async (jobId: string): Promise<void> => {
    try {
      const verdict = await checkRole(db, net, jobId, now());
      // "open" already dismissed the reports; the others keep them, with the answer.
      if (verdict && verdict !== "open") setVerdict.run(verdict, jobId);
      console.log(`[reports] checked ${jobId}: ${verdict ?? "not checked"}`);
    } catch (err) {
      console.error(`[reports] check of ${jobId} failed:`, err);
    } finally {
      pending.delete(jobId);
    }
  };

  return {
    enqueue(jobId) {
      if (pending.has(jobId) || pending.size >= MAX_PENDING_CHECKS) return;
      pending.add(jobId);
      chain = chain.then(() => check(jobId));
    },
    idle: () => chain,
  };
}

export interface ReportsRouterOptions {
  queue: ReportQueue;
  /** Visitor key → stored hash. */
  ipSalt?: string;
  reportsPerHour?: number;
  /** The visitor's IP (see clientIp in app.ts). */
  clientIp: (req: Request) => string;
}

/**
 * POST /api/jobs/:id/report — "Role closed?". Records the report and queues
 * a liveness check; it never closes the role itself.
 *
 * Abuse protections: a per-visitor hourly limit (on top of the API's
 * per-minute one); one report per visitor and role per week; visitors are
 * counted by a salted hash of their IP (an IPv6 visitor by their /56), so
 * hiding a role takes several networks; and the body must be JSON from our
 * own pages, so another website can't make its visitors' browsers report.
 */
export function createReportsRouter(db: Db, { queue, ipSalt = DEV_REPORT_IP_SALT, reportsPerHour = DEFAULT_REPORTS_PER_HOUR, clientIp }: ReportsRouterOptions): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 3_600_000,
    limit: reportsPerHour,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    message: { error: "Too many reports, please try again later." },
    validate: { xForwardedForHeader: false },
  });
  const findOpen = db.prepare("SELECT closed_at FROM jobs WHERE id = ?");

  router.post("/:id/report", limiter, (req, res) => {
    // A cross-site form can only send form or text bodies, and a cross-site
    // fetch with JSON needs a CORS preflight, which POST never passes.
    if (!req.is("application/json") || req.header("sec-fetch-site") === "cross-site") {
      res.status(415).json({ error: "Send the report as JSON from job-radar." });
      return;
    }
    const id = String(req.params.id);
    const job = findOpen.get(id) as { closed_at: string | null } | undefined;
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.closed_at) {
      res.json({ status: "closed" });
      return;
    }
    const { outcome } = recordReport(db, id, hashIp(ipKeyGenerator(clientIp(req)), ipSalt), new Date());
    if (outcome === "recorded") queue.enqueue(id);
    res.status(202).json({ status: outcome === "recorded" ? "checking" : "already-reported" });
  });

  return router;
}
