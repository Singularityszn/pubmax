// Every /api route goes through securityProxy and never through Clerk.
//
// The 28 Sep security review asked whether /api callers should stay under
// clerkMiddleware or go straight to securityProxy. The answer, shipped on
// 2 Oct, is securityProxy for every /api path on every host: nothing under
// app/api reads Clerk auth, each route owns its own auth check, and a Clerk
// handshake must never answer before the trailing-slash 308, the store
// refusal or the route itself. See
// docs/rules/lib-identity-accounts-and-sessions.md.
//
// clerkProxyCsp.test.ts pins that rule on a handful of sample paths. This file
// pins it on every route handler that exists, so a predicate that drops one
// prefix, or a new route that falls outside the matcher, fails here by name.

import { NextRequest, type NextFetchEvent } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { config } from "@/proxy";

const API_ROOT = join(process.cwd(), "app/api");
const PUBLISHABLE_KEY = "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk";
const HOSTS = ["pubmaxxing.com", "pubmax-preview.vercel.app"] as const;

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith("_") ? [] : routeFiles(path);
    return /^route\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

// One concrete request path per URL shape the route answers. A dynamic
// segment takes a sample value, a catch-all takes two segments, and an
// optional catch-all takes both its empty and its filled form. A route group
// adds nothing to the URL.
function samplePaths(file: string): string[] {
  const segments = relative(API_ROOT, file).split(sep).slice(0, -1);
  let paths = ["/api"];
  for (const segment of segments) {
    if (/^\(.+\)$/.test(segment)) continue;
    const optionalCatchAll = /^\[\[\.\.\..+\]\]$/.test(segment);
    const values = optionalCatchAll
      ? ["", "/sample/deeper"]
      : /^\[\.\.\..+\]$/.test(segment)
        ? ["/sample/deeper"]
        : /^\[.+\]$/.test(segment)
          ? ["/sample"]
          : [`/${segment}`];
    paths = paths.flatMap((path) => values.map((value) => `${path}${value}`));
  }
  return paths;
}

const ROUTES = routeFiles(API_ROOT).map((file) => ({
  file: relative(process.cwd(), file),
  paths: samplePaths(file),
}));
const PATHS = [...new Set(ROUTES.flatMap((route) => route.paths))].sort();

describe("the /api route inventory", () => {
  it("finds every route handler, including the catch-all", () => {
    expect(ROUTES.length).toBeGreaterThan(150);
    expect(PATHS).toContain("/api");
    expect(PATHS).toContain("/api/sample/deeper");
    expect(PATHS).toContain("/api/version");
    expect(PATHS).toContain("/api/cron/freshness-audit");
  });
});

describe("the proxy matcher runs on every /api route", () => {
  it.each(HOSTS)("matches every route on %s, prefetch or not", (host) => {
    const missed = PATHS.flatMap((path) => {
      const url = `https://${host}${path}`;
      return [
        unstable_doesMiddlewareMatch({ config, url }) ? [] : [path],
        unstable_doesMiddlewareMatch({
          config,
          url,
          headers: { "next-router-prefetch": "1", purpose: "prefetch" },
        })
          ? []
          : [`${path} (prefetch)`],
      ].flat();
    });
    expect(missed).toEqual([]);
  });
});

describe("every /api route skips Clerk once both keys are set", () => {
  const clerkProxy = vi.fn(() => new Response(null, { status: 418 }));
  let proxy: (request: NextRequest, event: NextFetchEvent) => unknown;

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_not_a_real_key");
    vi.resetModules();
    vi.doMock("@clerk/nextjs/server", () => ({
      clerkMiddleware: vi.fn(() => clerkProxy),
    }));
    ({ proxy } = await import("@/proxy"));
  });

  afterAll(() => {
    vi.doUnmock("@clerk/nextjs/server");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds the Clerk composition, so the bypass is what is under test", async () => {
    const response = await proxy(new NextRequest("https://pubmaxxing.com/login"), {} as NextFetchEvent);
    expect((response as Response).status).toBe(418);
    clerkProxy.mockClear();
  });

  it.each(HOSTS)("hands every route on %s to securityProxy", async (host) => {
    const wrong: string[] = [];
    for (const path of PATHS) {
      for (const method of ["GET", "POST"] as const) {
        const response = await proxy(
          new NextRequest(`https://${host}${path}`, {
            method,
            // The one request shape Clerk can answer with a handshake redirect
            // before its handler runs: a document-shaped GET.
            headers: { host, accept: "text/html", "sec-fetch-dest": "document" },
          }),
          {} as NextFetchEvent,
        );
        if (
          !(response instanceof Response) ||
          response.status !== 200 ||
          response.headers.get("x-middleware-next") !== "1" ||
          response.headers.get("location") !== null ||
          response.headers.get("Content-Security-Policy") !== null
        ) {
          wrong.push(`${method} ${path}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(clerkProxy).not.toHaveBeenCalled();
  });
});
