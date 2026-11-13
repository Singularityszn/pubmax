import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { securityProxy } from "@/proxy";

function rewriteTargetFor(path: string): string | null {
  const response = securityProxy(
    new NextRequest(`https://pubmaxxing.com${path}`, { headers: { host: "pubmaxxing.com" } }),
  );
  const rewritten = response.headers.get("x-middleware-rewrite");
  return rewritten ? new URL(rewritten, "https://pubmaxxing.com").pathname : null;
}

describe("a path ending in an encoded separator", () => {
  it.each(["/og.png%5C", "/og.png%5c", "/about%5C", "/about%5C%5C", "/og.png%2F", "/about%2f"])(
    "%s is rewritten to the not-found route",
    (path) => {
      expect(rewriteTargetFor(path)).toBe("/_not-found");
    },
  );

  it.each(["/about", "/og.png%5Cx", "/u/a%2Fb"])("%s is left alone", (path) => {
    expect(rewriteTargetFor(path)).toBeNull();
  });
});
