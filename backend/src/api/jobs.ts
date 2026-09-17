import { Router } from "express";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { Job } from "../types/job.js";

const querySchema = z.object({
  keyword: z.string().trim().min(1).optional(),
  location: z.string().trim().min(1).optional(),
  remoteOnly: z
    .enum(["true", "false"], {
      errorMap: () => ({ message: "remoteOnly must be 'true' or 'false'" }),
    })
    .optional()
    .transform((v) => v === "true"),
  source: z.string().trim().min(1).optional(),
  postedAfter: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "postedAfter must be a valid ISO date string",
    })
    .optional(),
});

interface JobRow {
  id: string;
  source: string;
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  remote: number;
  url: string;
  description: string | null;
  tags: string;
  posted_at: string | null;
  first_seen_at: string;
}

function rowToJob(row: JobRow): Job {
  let tags: string[];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    company: row.company,
    location: row.location,
    remote: Boolean(row.remote),
    url: row.url,
    description: row.description,
    tags,
    postedAt: row.posted_at,
    firstSeenAt: row.first_seen_at,
  };
}

/** Escapes LIKE metacharacters so user input can't alter the match pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function createJobsRouter(db: Database.Database): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const { keyword, location, remoteOnly, source, postedAfter } = parsed.data;

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (keyword) {
      conditions.push(
        "(title LIKE @keyword ESCAPE '\\' OR company LIKE @keyword ESCAPE '\\' OR description LIKE @keyword ESCAPE '\\')"
      );
      params.keyword = `%${escapeLike(keyword)}%`;
    }
    if (location) {
      conditions.push("location LIKE @location ESCAPE '\\'");
      params.location = `%${escapeLike(location)}%`;
    }
    if (remoteOnly) {
      conditions.push("remote = 1");
    }
    if (source) {
      conditions.push("source = @source");
      params.source = source;
    }
    if (postedAfter) {
      conditions.push("posted_at IS NOT NULL AND posted_at >= @postedAfter");
      params.postedAfter = postedAfter;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db
      .prepare(
        `SELECT * FROM jobs
         ${whereClause}
         ORDER BY
           CASE WHEN posted_at IS NULL THEN 1 ELSE 0 END,
           posted_at DESC,
           first_seen_at DESC`
      )
      .all(params) as JobRow[];

    const jobs = rows.map(rowToJob);
    res.json({ jobs, total: jobs.length });
  });

  return router;
}
