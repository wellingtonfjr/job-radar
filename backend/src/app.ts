import fs from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { createJobsRouter } from "./api/jobs.js";
import { createStatsRouter } from "./api/stats.js";
import type { Db } from "./db/index.js";

/**
 * Paths ending in one of these are files. If they reached the SPA fallback
 * the file doesn't exist, so they get a 404 instead of index.html (which a
 * browser would choke on as "Unexpected token '<'"). A list rather than
 * "contains a dot" because job ids can (e.g. "...himalayas.app%2F...").
 */
const FILE_EXTENSION = /\.(?:js|mjs|css|map|json|txt|xml|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|webmanifest)$/i;

export interface AppOptions {
  corsOrigin?: string;
  /** Built frontend to serve (frontend/dist); ignored if it has no index.html. */
  staticDir?: string;
}

export function createApp(db: Db, { corsOrigin = "*", staticDir }: AppOptions = {}) {
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

  // The built frontend, served from the same origin as the API. Only when a
  // build exists: in development the Vite dev server serves the frontend.
  if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
    app.use(
      express.static(staticDir, {
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            // Hashed file names: this exact name never changes content.
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            // index.html and other fixed names: always revalidate (cheap 304).
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );

    // SPA fallback: React pages (/, /jobs/:id …) aren't files, so any other
    // GET gets index.html and the client-side router takes it from there.
    app.get("*", (req, res, next) => {
      if (FILE_EXTENSION.test(req.path)) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("[api] unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(onError);

  return app;
}
