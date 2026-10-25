import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";

// A tiny limit keeps the test fast; the mechanism is the same at 180.
const LIMIT = 3;

let db: Db;
let server: Server;
let base: string;

/** A request as Fly's proxy would deliver it from visitor `ip`. */
function getAs(ip: string, path = "/api/stats"): Promise<Response> {
  return fetch(`${base}${path}`, { headers: { "Fly-Client-IP": ip } });
}

beforeAll(async () => {
  db = openDb(":memory:");
  server = createApp(db, { rateLimitPerMinute: LIMIT }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

describe("API rate limit", () => {
  it("lets a visitor make LIMIT requests per minute, then answers 429 in JSON", async () => {
    for (let i = 1; i <= LIMIT; i++) {
      const res = await getAs("200.10.20.30");
      expect(res.status).toBe(200);
    }
    const blocked = await getAs("200.10.20.30");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("content-type")).toMatch(/application\/json/);
    expect(await blocked.json()).toEqual({ error: "Too many requests, please slow down." });
    // Standard headers tell the client when to retry.
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get("ratelimit-policy")).toContain(`${LIMIT}`);
  });

  it("counts each visitor separately (by Fly-Client-IP, not the proxy's address)", async () => {
    // Every test request comes from 127.0.0.1, like every request behind
    // Fly's proxy comes from the proxy. A new visitor still has a full budget.
    const res = await getAs("45.6.7.8");
    expect(res.status).toBe(200);
  });

  it("treats addresses in the same IPv6 /56 block as one visitor", async () => {
    for (let i = 1; i <= LIMIT; i++) {
      expect((await getAs(`2001:db8:abcd:1200::${i}`)).status).toBe(200);
    }
    // A different address in the same /56 doesn't get a fresh budget.
    expect((await getAs("2001:db8:abcd:12ff::99")).status).toBe(429);
  });

  it("never limits the health check", async () => {
    for (let i = 0; i < LIMIT + 2; i++) {
      expect((await getAs("200.10.20.30", "/health")).status).toBe(200);
    }
  });
});
