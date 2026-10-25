import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "../src/app.js";
import { openDb } from "../src/db/index.js";

/** Calls /api/stats as a page on `origin` would, with the app built from `options`. */
async function apiFromOrigin(options: AppOptions, origin: string): Promise<Response> {
  const db = openDb(":memory:");
  const server: Server = createApp(db, options).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}/api/stats`, { headers: { Origin: origin } });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
}

describe("CORS", () => {
  it("sends no CORS header by default, so other sites can't read the API", async () => {
    const res = await apiFromOrigin({}, "https://copycat.example");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows exactly the configured origin when CORS_ORIGIN is set", async () => {
    const res = await apiFromOrigin({ corsOrigin: "https://app.job-radar.dev" }, "https://app.job-radar.dev");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.job-radar.dev");
  });
});
