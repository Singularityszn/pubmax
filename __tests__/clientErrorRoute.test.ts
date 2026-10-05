import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const limiter = vi.hoisted(() => ({ limited: false }));

vi.mock("@/lib/clientErrorRateLimit", () => ({
  isClientErrorLimited: vi.fn(async () => limiter.limited),
}));

import { POST } from "@/app/api/client-error/route";
import { isClientErrorLimited } from "@/lib/clientErrorRateLimit";
import { defined } from "@/__tests__/helpers/defined";

// GAP 16. POST /api/client-error is public and unauthenticated by design: a
// WebView that has just thrown cannot prove anything first. What holds it
// honest is that it stores nothing, answers 204 to everything, spends a
// per-IP budget through isLimited, and rebuilds the report SERVER-SIDE through
// the same module the browser used, so a hand-rolled POST cannot describe
// itself differently from the reporter.

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://pubmaxxing.com/api/client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

let warn: ReturnType<typeof vi.spyOn>;

function loggedReports(): Record<string, unknown>[] {
  const calls = warn.mock.calls as unknown as unknown[][];
  return calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("[pubmax-client-error] "))
    .map((line) => JSON.parse(line.replace("[pubmax-client-error] ", "")) as Record<string, unknown>);
}

beforeEach(() => {
  limiter.limited = false;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/client-error", () => {
  it("logs one redacted line and answers 204 with no store", async () => {
    const res = await POST(
      post({
        kind: "error",
        name: "TypeError",
        message: "Failed to fetch https://pubmaxxing.com/map?sel=venue-1",
        path: "/u/some-drinker",
        shell: "native",
      }),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [report] = loggedReports();
    expect(report).toMatchObject({
      kind: "error",
      name: "TypeError",
      message: "Failed to fetch <url>",
      route: "/u/[handle]",
      shell: "native",
    });
    // The server owns the timestamp, and nothing else rides along.
    expect(typeof defined(report).ts).toBe("string");
    expect(Object.keys(defined(report)).sort()).toEqual(["kind", "message", "name", "route", "shell", "ts"]);
  });

  it("redacts again on arrival, because a direct POST is not the reporter", async () => {
    await POST(
      post({
        kind: "unhandledrejection",
        name: "Error",
        message: "no account for drinker@example.com token=abcdef123456",
        path: "/map",
        shell: "web",
      }),
    );

    const [report] = loggedReports();
    expect(defined(report).message).not.toContain("drinker@example.com");
    expect(defined(report).message).not.toContain("abcdef123456");
  });

  it("spends the per-IP budget and logs nothing when over it", async () => {
    limiter.limited = true;

    const res = await POST(post({ kind: "error", message: "boom", path: "/map" }));

    expect(res.status).toBe(204);
    expect(isClientErrorLimited).toHaveBeenCalled();
    expect(loggedReports()).toHaveLength(0);
  });

  it("drops a body over the bound without parsing it", async () => {
    const res = await POST(post({ kind: "error", message: "x".repeat(4_000), path: "/map" }));

    expect(res.status).toBe(204);
    expect(loggedReports()).toHaveLength(0);
  });

  it("drops malformed and unreportable bodies alike", async () => {
    for (const body of ["not json", JSON.stringify(null), JSON.stringify([1, 2]), { kind: "crash", message: "boom" }, { kind: "error", message: "" }]) {
      const res = await POST(post(body));
      expect(res.status).toBe(204);
    }
    expect(loggedReports()).toHaveLength(0);
  });

  it("never takes a URL as the route, whatever a caller posts", async () => {
    await POST(
      post({
        kind: "error",
        message: "boom",
        path: "https://pubmaxxing.com/messages/conv-1?token=abc",
        shell: "web",
      }),
    );

    expect(defined(loggedReports()[0]).route).toBeNull();
  });
});
