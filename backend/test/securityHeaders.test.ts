import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/index.js";

let db: Db;
let server: Server;
let base: string;

beforeAll(async () => {
  db = openDb(":memory:");
  server = createApp(db).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

/** The CSP as a map of directive → sources. */
function parseCsp(header: string | null): Record<string, string[]> {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name as string, sources]),
  );
}

describe("security headers", () => {
  it("only lets our own scripts, styles and API run, but logos load from any HTTPS host", async () => {
    const csp = parseCsp((await fetch(`${base}/api/stats`)).headers.get("content-security-policy"));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["style-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["img-src"]).toEqual(["'self'", "https:", "data:"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
  });

  it("sends helmet's protective defaults", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});
