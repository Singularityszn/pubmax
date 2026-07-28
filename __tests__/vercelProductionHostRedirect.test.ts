import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  config,
  proxy,
  VERCEL_PREVIEW_HOST_SETTING,
} from "@/proxy";

beforeEach(() => {
  vi.stubEnv(VERCEL_PREVIEW_HOST_SETTING, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(
  host: string,
  path = "/u/you",
): NextRequest {
  return new NextRequest(`https://request-origin.invalid${path}`, {
    headers: { host },
  });
}

function expectCanonicalRedirect(
  response: Response,
  location: string,
): void {
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(location);
}

describe("Vercel production host canonicalisation", () => {
  it.each(["/", "/api/heritage", "/_next/static/chunks/app.js"])(
    "runs the proxy for Vercel path %s",
    (path) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://chengdu-pubmax69.vercel.app${path}`,
          headers: { host: "chengdu-pubmax69.vercel.app" },
        }),
      ).toBe(true);
    },
  );

  it("owns the generated Vercel hostname namespace without an alias list", () => {
    expect(config.matcher).toContainEqual({
      source: "/:path*",
      has: [{ type: "host", value: ".+\\.vercel\\.app" }],
    });
  });

  it("permanently redirects production Vercel hosts with path and query intact", () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const response = proxy(
      request(
        "chengdu-pubmax69.vercel.app",
        "/map/where?sel=venue-xjf3n0&next=%2Fu%2Fyou",
      ),
    );

    expectCanonicalRedirect(
      response,
      "https://pubmaxxing.com/map/where?sel=venue-xjf3n0&next=%2Fu%2Fyou",
    );
  });

  it("redirects a promoted Preview artifact when no preview opt-out is set", () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    expectCanonicalRedirect(
      proxy(request("chengdu-pubmax69.vercel.app")),
      "https://pubmaxxing.com/u/you",
    );
  });

  it.each([
    "/api/heritage?venue=the-ship",
    "/_next/static/chunks/app.js?v=1",
  ])("redirects excluded proxy path %s on a production Vercel host", (path) => {
    vi.stubEnv("VERCEL_ENV", "production");

    expectCanonicalRedirect(
      proxy(request("chengdu-pubmax69.vercel.app", path)),
      `https://pubmaxxing.com${path}`,
    );
  });

  it("allows a Preview host only through the explicit preview setting", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv(VERCEL_PREVIEW_HOST_SETTING, "1");

    const response = proxy(
      request("chengdu-git-auth-preview-pubmax69.vercel.app"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("ignores the preview setting outside the Preview environment", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv(VERCEL_PREVIEW_HOST_SETTING, "1");

    expectCanonicalRedirect(
      proxy(request("chengdu-pubmax69.vercel.app")),
      "https://pubmaxxing.com/u/you",
    );
  });

  it.each([
    "pubmaxxing.com",
    "localhost:3000",
    "127.0.0.1:3000",
    "[::1]:3000",
    "192.168.1.20:3000",
  ])("passes through canonical and local host %s", (host) => {
    vi.stubEnv("VERCEL_ENV", "production");

    const response = proxy(request(host));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
