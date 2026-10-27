import fs from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type Request } from "express";
import { createJobsRouter } from "./api/jobs.js";
import { createStatsRouter } from "./api/stats.js";
import { DEFAULT_RATE_LIMIT_PER_MINUTE } from "./config.js";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { Db } from "./db/index.js";

/**
 * Paths ending in one of these are files. If they reached the SPA fallback
 * the file doesn't exist, so they get a 404 instead of index.html (which a
 * browser would choke on as "Unexpected token '<'"). A list rather than
 * "contains a dot" because job ids can (e.g. "...himalayas.app%2F...").
 */
const FILE_EXTENSION = /\.(?:js|mjs|css|map|json|txt|xml|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|webmanifest)$/i;

/**
 * The visitor's IP. Behind Fly's proxy every connection comes from the proxy,
 * which puts the real client IP in Fly-Client-IP; locally there's no proxy,
 * so the connection's own address is the visitor. (X-Forwarded-For is not
 * used: its leftmost entries can be forged by the client.)
 */
export function clientIp(req: Request): string {
  return req.header("fly-client-ip") ?? req.socket.remoteAddress ?? "unknown";
}

export interface AppOptions {
  /** Origin allowed to read the API cross-origin; omit for same-origin only. */
  corsOrigin?: string;
  /** Built frontend to serve (frontend/dist); ignored if it has no index.html. */
  staticDir?: string;
  /** API requests allowed per visitor per minute. */
  rateLimitPerMinute?: number;
}

export function createApp(db: Db, { corsOrigin, staticDir, rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE }: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");

  // Security headers on every response (pages, files and API). The CSP only
  // allows our own scripts, styles and API; company logos come from the job
  // sources' CDNs, so images may load from any HTTPS origin (images can't
  // run code). Helmet's other defaults (HSTS, nosniff, …) stay on.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "https:", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      // Employers see that a candidate came from job-radar, but not the
      // search or filters in the URL.
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );

  // Per-visitor limit on the API only: static files are cheap and cached,
  // and /health must stay reachable for the platform's health checks.
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: rateLimitPerMinute,
    // Standard RateLimit headers tell well-behaved clients how much is left.
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // ipKeyGenerator groups an IPv6 visitor's whole /56 block into one key,
    // so rotating addresses inside it doesn't reset the count.
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    message: { error: "Too many requests, please slow down." },
    // We deliberately key on Fly-Client-IP, so the library's warning about
    // the (always present) X-Forwarded-For header doesn't apply.
    validate: { xForwardedForHeader: false },
  });

  // CORS is opt-in. The UI is served from the same origin, which needs no
  // CORS header at all; sending "*" would let any other website read the
  // API through its own visitors' browsers (each with its own IP, so the
  // rate limit wouldn't help). Set CORS_ORIGIN to allow one specific origin.
  if (corsOrigin) {
    app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", corsOrigin);
      res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      next();
    });
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", apiLimiter);
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
