import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db/index.js";
import { reportError, setErrorReporter, type ErrorReporter } from "../src/errors.js";
import { startScheduler } from "../src/ingestion/scheduler.js";
import { fakeSource } from "./helpers.js";

function fakeReporter() {
  const captured: { error: unknown; properties: Record<string, unknown> }[] = [];
  const reporter: ErrorReporter = { capture: (error, properties) => captured.push({ error, properties }), flush: () => Promise.resolve() };
  return { reporter, captured };
}

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe("reportError", () => {
  it("logs as before and sends the error with where it happened", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reporter, captured } = fakeReporter();
    setErrorReporter(reporter);
    reportError("ingest", "cycle failed", new Error("boom"), { source: "x" });
    expect(log).toHaveBeenCalledWith("[ingest] cycle failed:", expect.any(Error));
    expect(captured).toHaveLength(1);
    expect((captured[0]!.error as Error).message).toBe("boom");
    expect(captured[0]!.properties).toEqual({ area: "ingest", context: "cycle failed", runtime: "server", source: "x" });
  });

  it("wraps non-Error values and never throws when reporting fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { reporter, captured } = fakeReporter();
    setErrorReporter(reporter);
    reportError("api", "oops", "a string");
    expect((captured[0]!.error as Error).message).toBe("a string");
    setErrorReporter({ capture: () => { throw new Error("down"); }, flush: () => Promise.resolve() });
    expect(() => reportError("api", "oops", new Error("x"))).not.toThrow();
  });

  it("only logs without a reporter (dev and tests)", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => reportError("api", "oops", new Error("x"))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("tracked server errors", () => {
  it("reports an API 500 with method and route, never request data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { reporter, captured } = fakeReporter();
    setErrorReporter(reporter);
    const db = openDb(":memory:");
    const app = createApp(db);
    db.close(); // every query now throws
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jobs?q=secret`);
      expect(res.status).toBe(500);
    } finally {
      server.close();
    }
    expect(captured).toHaveLength(1);
    expect(captured[0]!.properties).toMatchObject({ area: "api", context: "unhandled error", method: "GET" });
    expect(JSON.stringify(captured[0]!.properties)).not.toContain("secret");
  });

  it("reports a source that read nothing, not one with a few failing boards", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { reporter, captured } = fakeReporter();
    setErrorReporter(reporter);
    const db = openDb(":memory:");
    const down = fakeSource("down");
    down.respond({ results: [], errors: [{ feed: "all", error: "responded 503" }] });
    const partial = fakeSource("partial");
    partial.respond({ results: [{ feed: "a", complete: true, jobs: [] }], errors: [{ feed: "b", error: "responded 429" }] });
    const scheduler = startScheduler(db, [down, partial], { tickMinutes: 60, staleAfterDays: 30, ingestIntervalHours: 12, pruneAfterDays: 0 });
    await scheduler.idle();
    scheduler.stop();
    expect(captured.map((c) => c.properties.source)).toEqual(["down"]);
    expect((captured[0]!.error as Error).message).toBe("down: all: responded 503");
  });
});
