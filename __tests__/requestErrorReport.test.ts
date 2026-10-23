import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequestError } from "@/instrumentation";
import { reportRequestError } from "@/lib/requestErrorReport";

function errorLines(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((line): line is Record<string, unknown> => line != null);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("reportRequestError", () => {
  it("writes one error line with the route template, type, digest and request id", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new TypeError("row for ripley_the_fox: Key (email)=(a@b.c)"), {
      digest: "4242",
    });

    reportRequestError(
      error,
      {
        path: "/api/profiles/ripley_the_fox?token=abc",
        method: "PATCH",
        headers: { "x-vercel-id": "lhr1::abcd-1792215966-0f1e" },
      },
      { routerKind: "App Router", routePath: "/api/profiles/[handle]", routeType: "route" },
    );

    const [line] = errorLines(consoleError);
    expect(line).toMatchObject({
      level: "error",
      event: "request.unhandled",
      route: "/api/profiles/[handle]",
      routeType: "route",
      method: "PATCH",
      errorType: "TypeError",
      digest: "4242",
      vercelId: "lhr1::abcd-1792215966-0f1e",
    });
    // Neither the request path nor the error message reaches the line.
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain("ripley_the_fox");
    expect(serialized).not.toContain("a@b.c");
    expect(serialized).not.toContain("token=abc");
  });

  it("accepts a thrown non-Error and a missing context", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    reportRequestError("boom", { path: "/", method: "GET", headers: {} }, {});
    expect(errorLines(consoleError)[0]).toMatchObject({
      event: "request.unhandled",
      route: "unknown",
      errorType: "Error",
    });
  });
});

describe("instrumentation onRequestError", () => {
  it("is exported, reports the error and never throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      onRequestError(
        new Error("x"),
        { path: "/api/plans/generate", method: "POST", headers: {} },
        { routePath: "/api/plans/generate", routeType: "route" },
      ),
    ).resolves.toBeUndefined();
    expect(errorLines(consoleError).some((line) => line.event === "request.unhandled")).toBe(true);
  });
});
