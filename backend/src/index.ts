import express from "express";
import { openDb } from "./db/index.js";
import { createJobsRouter } from "./api/jobs.js";

const app = express();
const db = openDb();
const PORT = process.env.PORT ?? 3001;

// Local dashboard runs on a different origin (Vite dev server); this is a
// read-only public API with no auth/cookies, so an open CORS policy is fine.
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/jobs", createJobsRouter(db));

app.listen(PORT, () => {
  console.log(`job-radar backend listening on http://localhost:${PORT}`);
});
