// The proxy's two survival guarantees, now that Clerk is composed into it.
//
// Clerk's quickstart tells you to CREATE proxy.ts with clerkMiddleware(). This
// repository already had one, carrying the canonical-host redirect and a
// per-request nonce CSP. Both are load-bearing, and both are easy to lose in a
// Clerk upgrade that follows the quickstart literally. These tests fail loudly
// if either is dropped, and they fail if the CSP is widened to buy Clerk its
// origins the lazy way.

import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLERK_ABUSE_PROTECTION_ORIGIN,
  CLERK_BOT_PROTECTION_ORIGIN,
  CLERK_IMAGE_ORIGIN,
  clerkCspSources,
  clerkFrontendApiOrigin,
  isClerkConfigured,
  isClerkMiddlewareConfigured,
} from "@/lib/clerkIdentity";
import { isClerkProductSessionAvailable } from "@/lib/clerkAvailability";
import { config, securityProxy } from "@/proxy";

/**
 * The captain's development instance key. It is a PUBLISHABLE key, so it is
 * safe in the repository — that is the whole point of the pk_/sk_ split. The
 * secret key is never read here, and never committed anywhere.
 */
const PUBLISHABLE_KEY = "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk";
const FRONTEND_API = "https://rare-trout-29.clerk.accounts.dev";

function policyFor(path = "/map"): string {
  const response = securityProxy(
    new NextRequest(`https://pubmaxxing.com${path}`, {
      headers: { host: "pubmaxxing.com" },
    }),
  );
  const policy = response.headers.get("Content-Security-Policy");
  expect(policy).toBeTruthy();
  return policy as string;
}

function directive(policy: string, name: string): string | undefined {
  return policy
    .split("; ")
    .find((entry) => entry === name || entry.startsWith(`${name} `));
}

describe("Clerk publishable key decoding", () => {
  it("requires server-confirmed two-key configuration and a product session for visible controls", () => {
    expect(isClerkProductSessionAvailable(null, true)).toBe(false);
    expect(isClerkProductSessionAvailable({ id: "account-a" }, true)).toBe(true);
    expect(isClerkProductSessionAvailable({ id: "account-a" }, false)).toBe(false);
  });

  it("passes only the server-derived two-key boolean into the client auth provider", () => {
    const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");

    expect(layout).toContain(
      "const clerkIntegrationConfigured = isClerkMiddlewareConfigured();",
    );
    expect(layout).toContain(
      "<AuthProvider clerkIntegrationConfigured={clerkIntegrationConfigured}>",
    );
    expect(layout).not.toContain("process.env.CLERK_SECRET_KEY");

    for (const clientPath of [
      "components/auth/AuthProvider.tsx",
      "components/auth/ClerkAccountControls.tsx",
      "components/auth/SignInButton.tsx",
    ]) {
      const clientSource = readFileSync(join(process.cwd(), clientPath), "utf8");
      expect(clientSource).toContain("@/lib/clerkAvailability");
      expect(clientSource).not.toContain("@/lib/clerkIdentity");
    }
  });

  it("decodes with atob when Buffer is absent (browser path)", () => {
    // The client gate calls clerkFrontendApiOrigin during render. A Buffer-only
    // decode returns null in the browser and hides every Clerk control.
    const realBuffer = globalThis.Buffer;
    // @ts-expect-error intentional temporary deletion for the browser path
    delete globalThis.Buffer;
    try {
      expect(typeof globalThis.Buffer).toBe("undefined");
      expect(clerkFrontendApiOrigin(PUBLISHABLE_KEY)).toBe(FRONTEND_API);
      expect(isClerkConfigured(PUBLISHABLE_KEY)).toBe(true);
    } finally {
      globalThis.Buffer = realBuffer;
    }
  });

  it("derives the instance Frontend API origin from the key", () => {
    expect(clerkFrontendApiOrigin(PUBLISHABLE_KEY)).toBe(FRONTEND_API);
  });

  it("treats a live key the same way", () => {
    const liveKey = `pk_live_${Buffer.from("clerk.pubmaxxing.com$").toString("base64")}`;
    expect(clerkFrontendApiOrigin(liveKey)).toBe("https://clerk.pubmaxxing.com");
  });

  it.each([
    ["an empty value", ""],
    ["an undefined value", undefined],
    ["a secret key", "sk_test_abcdef"],
    ["a key with no recognised prefix", "cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk"],
    ["a payload missing its $ terminator", `pk_test_${Buffer.from("evil.example").toString("base64")}`],
    ["a payload carrying a scheme", `pk_test_${Buffer.from("https://evil.example$").toString("base64")}`],
    ["a payload carrying a path", `pk_test_${Buffer.from("evil.example/x$").toString("base64")}`],
    ["a payload carrying a port", `pk_test_${Buffer.from("evil.example:8443$").toString("base64")}`],
    ["a payload carrying a wildcard", `pk_test_${Buffer.from("*.example.com$").toString("base64")}`],
    ["a payload carrying a space", `pk_test_${Buffer.from("evil.example 'unsafe-inline'$").toString("base64")}`],
  ])("fails closed on %s", (_label, key) => {
    expect(clerkFrontendApiOrigin(key)).toBeNull();
    expect(isClerkConfigured(key)).toBe(false);
    // Nothing reaches the policy from a value we refused to trust.
    const sources = clerkCspSources(key);
    expect([
      ...sources.script,
      ...sources.connect,
      ...sources.img,
      ...sources.frame,
    ]).toEqual([]);
  });
});

describe("Clerk CSP sources", () => {
  const sources = clerkCspSources(PUBLISHABLE_KEY);

  it("admits the exact Clerk origins and nothing broader", () => {
    expect(sources.script).toEqual([
      FRONTEND_API,
      CLERK_BOT_PROTECTION_ORIGIN,
      CLERK_ABUSE_PROTECTION_ORIGIN,
    ]);
    expect(sources.connect).toEqual([FRONTEND_API, CLERK_ABUSE_PROTECTION_ORIGIN]);
    expect(sources.img).toEqual([CLERK_IMAGE_ORIGIN]);
    expect(sources.frame).toEqual([
      CLERK_BOT_PROTECTION_ORIGIN,
      CLERK_ABUSE_PROTECTION_ORIGIN,
    ]);
  });

  it("never introduces a wildcard directive or a bare scheme", () => {
    for (const origin of [
      ...sources.script,
      ...sources.connect,
      ...sources.img,
      ...sources.frame,
    ]) {
      expect(origin.startsWith("https://")).toBe(true);
      expect(origin).not.toBe("https://*");
      expect(origin).not.toContain("'unsafe");
      // A wildcard is tolerated ONLY as a subdomain of a Clerk-owned domain.
      if (origin.includes("*")) {
        expect(origin.startsWith("https://*.")).toBe(true);
        expect(origin.endsWith(".clerk.com")).toBe(true);
      }
    }
  });
});

describe("the CSP the proxy actually ships", () => {
  it("still carries a fresh per-request nonce", () => {
    const first = directive(policyFor(), "script-src");
    const second = directive(policyFor(), "script-src");

    expect(first).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(second).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    // Fresh per request: a reused nonce is no nonce at all.
    expect(first).not.toBe(second);
  });

  it("forwards the nonce to the render on x-nonce", () => {
    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/map", {
        headers: { host: "pubmaxxing.com" },
      }),
    );
    // Next.js reads the nonce back off the REQUEST Content-Security-Policy
    // header to stamp its inline RSC scripts; our own components read x-nonce.
    const forwarded = response.headers.get("x-middleware-request-x-nonce");
    expect(forwarded).toBeTruthy();
    expect(directive(policyFor(), "script-src")).toBeTruthy();
  });

  it("never admits 'unsafe-inline' into script-src", () => {
    const scriptSrc = directive(policyFor(), "script-src") ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("keeps object-src, base-uri and frame-ancestors locked down", () => {
    const policy = policyFor();
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("keeps the two directives Clerk needs that MapLibre already provided", () => {
    const policy = policyFor();
    // Clerk requires style-src 'unsafe-inline' (its runtime CSS-in-JS) and
    // worker-src 'self' blob:. Both predate Clerk. This asserts them so a
    // future MapLibre change cannot remove them without a Clerk failure being
    // visible here rather than only in a browser.
    expect(directive(policy, "style-src")).toContain("'unsafe-inline'");
    expect(directive(policy, "worker-src")).toBe("worker-src 'self' blob:");
  });

  it("leaves the policy unchanged while no Clerk key is configured", () => {
    // The suite runs without NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, so this is the
    // shipped-today policy. Clerk must cost nothing until it is switched on.
    expect(isClerkConfigured()).toBe(false);
    const policy = policyFor();
    expect(policy).not.toContain("clerk");
    expect(policy).not.toContain("challenges.cloudflare.com");
    // frame-src stays absent, so framing keeps falling through to child-src.
    expect(directive(policy, "frame-src")).toBeUndefined();
    expect(directive(policy, "child-src")).toBe("child-src blob:");
  });
});

describe("the CSP once a Clerk key is configured", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("admits Clerk into script-src while keeping the nonce and refusing 'unsafe-inline'", () => {
    const scriptSrc = directive(policyFor(), "script-src") ?? "";

    expect(scriptSrc).toContain(FRONTEND_API);
    expect(scriptSrc).toContain(CLERK_BOT_PROTECTION_ORIGIN);
    expect(scriptSrc).toContain(CLERK_ABUSE_PROTECTION_ORIGIN);
    // The two guarantees Clerk must not be allowed to buy its way out of.
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // The pre-existing sources are still there.
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("https://va.vercel-scripts.com");
  });

  it("admits Clerk into connect-src without disturbing Supabase or the tiles", () => {
    const connectSrc = directive(policyFor(), "connect-src") ?? "";

    expect(connectSrc).toContain(FRONTEND_API);
    expect(connectSrc).toContain(CLERK_ABUSE_PROTECTION_ORIGIN);
    // Both auth systems run side by side, so Supabase must keep its origins.
    expect(connectSrc).toContain("https://*.supabase.co");
    expect(connectSrc).toContain("wss://*.supabase.co");
    expect(connectSrc).toContain("https://tiles.openfreemap.org");
  });

  it("admits only Clerk's avatar CDN into img-src", () => {
    const imgSrc = directive(policyFor(), "img-src") ?? "";

    expect(imgSrc).toContain(CLERK_IMAGE_ORIGIN);
    // The "proxy-or-nothing" venue-image rule is untouched.
    expect(imgSrc).toContain("https://commons.wikimedia.org");
    expect(imgSrc).not.toContain("https://*.clerk.com");
  });

  it("adds frame-src for the challenge frames and keeps the blob: fallback", () => {
    const frameSrc = directive(policyFor(), "frame-src");

    expect(frameSrc).toBe(
      `frame-src blob: ${CLERK_BOT_PROTECTION_ORIGIN} ${CLERK_ABUSE_PROTECTION_ORIGIN}`,
    );
    // Framing no longer falls through to child-src, so blob: had to be carried
    // across explicitly or the fallback's permission would have been revoked.
    expect(frameSrc).toContain("blob:");
    expect(directive(policyFor(), "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("still redirects a production Vercel host", () => {
    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/map", {
        headers: { host: "chengdu-pubmax69.vercel.app" },
      }),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://pubmaxxing.com/map");
  });
});

describe("the canonical-host redirect survives the Clerk composition", () => {
  it("still redirects a production Vercel host to the canonical apex", () => {
    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/map?sel=venue-xjf3n0", {
        headers: { host: "chengdu-pubmax69.vercel.app" },
      }),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://pubmaxxing.com/map?sel=venue-xjf3n0",
    );
  });

  it("still strips a trailing slash", () => {
    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/crawls/", {
        headers: { host: "pubmaxxing.com" },
      }),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://pubmaxxing.com/crawls");
  });

  it("still passes the canonical host through untouched", () => {
    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/map", {
        headers: { host: "pubmaxxing.com" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("the middleware gate needs BOTH keys", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays off with only the publishable key", () => {
    // Observed, not theorised: running this app with only the publishable key
    // set made clerkMiddleware() throw "@clerk/nextjs: Missing secretKey" on
    // every request, so every page 500'd, not only sign-in. Public-key CSP
    // support may still turn on, but visible controls must remain off.
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    vi.stubEnv("CLERK_SECRET_KEY", "");

    expect(isClerkConfigured()).toBe(true);
    expect(isClerkMiddlewareConfigured()).toBe(false);
  });

  it("stays off with only the secret key", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_not_a_real_key");

    expect(isClerkConfigured()).toBe(false);
    expect(isClerkMiddlewareConfigured()).toBe(false);
  });

  it("turns on only once both keys are present", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_not_a_real_key");

    expect(isClerkMiddlewareConfigured()).toBe(true);
  });

  it("exports the plain security proxy and serves pages when the secret is missing", async () => {
    // The boolean gate above is necessary but not enough: the ship risk is that
    // proxy.ts still calls clerkMiddleware() at module load and that throw
    // becomes a site-wide 500. Re-import under a half-configured env and drive
    // the named export Next actually runs, so a future refactor that "knows"
    // isClerkMiddlewareConfigured but still constructs clerkMiddleware cannot
    // pass.
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.resetModules();

    const mod = await import("@/proxy");
    // Identity equality is the contract: half-configured deploys must not wrap
    // securityProxy in clerkMiddleware (whose type would also demand a second
    // NextFetchEvent argument Next never passes in our unit tests).
    expect(mod.proxy).toBe(mod.securityProxy);

    const response = mod.securityProxy(
      new NextRequest("https://pubmaxxing.com/map", {
        headers: { host: "pubmaxxing.com" },
      }),
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src");
  });
});

describe("the proxy export Next.js actually runs", () => {
  it("matches Clerk's own frontend API path", () => {
    expect(config.matcher).toContainEqual({ source: "/__clerk/:path*" });
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "https://pubmaxxing.com/__clerk/v1/environment",
      }),
    ).toBe(true);
  });

  it("keeps running on ordinary pages", () => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: "https://pubmaxxing.com/map" }),
    ).toBe(true);
  });
});
