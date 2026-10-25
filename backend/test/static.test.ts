import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";

/** Starts the app on a free port; returns its base URL and a stop function. */
async function start(db: Db, staticDir?: string): Promise<{ base: string; stop: () => Promise<void> }> {
  const server: Server = createApp(db, { staticDir }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, stop: () => new Promise((resolve) => server.close(() => resolve())) };
}

describe("serving the built frontend", () => {
  let db: Db;
  let dist: string;
  let app: { base: string; stop: () => Promise<void> };

  beforeAll(async () => {
    db = openDb(":memory:");
    // A tiny fake build, so the test doesn't depend on (or wait for) a real one.
    dist = fs.mkdtempSync(path.join(os.tmpdir(), "job-radar-dist-"));
    fs.mkdirSync(path.join(dist, "assets"));
    fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(dist, "assets", "app-123.js"), "console.log('app');");
    app = await start(db, dist);
  });

  afterAll(async () => {
    await app.stop();
    db.close();
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it("serves index.html for the home page, revalidated on every visit", async () => {
    const res = await fetch(`${app.base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain('<div id="root">');
  });

  it("serves hashed assets with a long, immutable cache", async () => {
    const res = await fetch(`${app.base}/assets/app-123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("answers React pages with index.html (SPA fallback)", async () => {
    const res = await fetch(`${app.base}/jobs/greenhouse%3A123`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain('<div id="root">');
  });

  it("doesn't mistake a job id containing a dot for a file", async () => {
    const res = await fetch(`${app.base}/jobs/himalayas%3Ahttps%3A%2F%2Fhimalayas.app%2Fcompanies%2Facme%2Fjobs%2Fdev`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it("returns 404 (not index.html) for files that don't exist", async () => {
    const res = await fetch(`${app.base}/assets/old-build.js`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<div id="root">');
  });

  it("never lets the fallback answer unknown API routes", async () => {
    const res = await fetch(`${app.base}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("keeps the API working alongside the frontend", async () => {
    const res = await fetch(`${app.base}/api/stats`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("without a frontend build (development)", () => {
  it("serves only the API", async () => {
    const db = openDb(":memory:");
    const missing = path.join(os.tmpdir(), "job-radar-no-build-here");
    const app = await start(db, missing);
    try {
      expect((await fetch(`${app.base}/`)).status).toBe(404);
      expect((await fetch(`${app.base}/jobs/greenhouse%3A123`)).status).toBe(404);
      expect((await fetch(`${app.base}/health`)).status).toBe(200);
    } finally {
      await app.stop();
      db.close();
    }
  });
});
