import express, { type ErrorRequestHandler } from "express";
import { createJobsRouter } from "./api/jobs.js";
import { createStatsRouter } from "./api/stats.js";
import type { Db } from "./db/index.js";

export function createApp(db: Db, { corsOrigin = "*" }: { corsOrigin?: string } = {}) {
  const app = express();
  app.disable("x-powered-by");

  // Read-only public API with no cookies/auth, so a permissive CORS policy
  // is safe; restrict with CORS_ORIGIN when deploying.
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", corsOrigin);
    res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/jobs", createJobsRouter(db));
  app.use("/api/stats", createStatsRouter(db));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("[api] unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(onError);

  return app;
}
