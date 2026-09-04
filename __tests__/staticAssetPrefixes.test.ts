// THE STATIC ASSET PREFIXES ARE A CONTRACT, AND THIS IS BOTH HALVES OF IT.
//
// Under the Wayfinder map (#1423), issue #1425 found that every request under
// /data ran proxy.ts as a Node function because the matcher did not exclude it,
// CDN hit included: two consecutive `x-vercel-cache: HIT` responses for one
// static file carried different CSP nonces, and a cached copy cannot mint a
// nonce. The 500 GrokBot saw on an 82 KB uk_base pack was that function
// failing in front of a healthy file.
//
// Excluding a prefix is cheap to write and expensive to get wrong in one
// direction: a prefix that ALSO names an app route would strip the per-request
// nonce off a rendered document, which is the contract
// docs/PERFORMANCE_BUDGETS.md says no route but `/` and `/map` may lose. So the
// list is fenced from both sides here.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import {
  STATIC_ASSET_PREFIXES,
  isStaticAssetPath,
  staticAssetHeaderSources,
  staticAssetMatcherAlternatives,
} from "@/lib/staticAssetPrefixes.mjs";
import { config } from "@/proxy";

const ROOT = process.cwd();

/** The general rule: the one matcher entry that claims ordinary paths. */
function generalMatcherSource(): string {
  const entry = config.matcher.find(
    (rule) =>
      typeof rule === "object" &&
      typeof rule.source === "string" &&
      rule.source.includes("_next/static"),
  );
  if (!entry || typeof entry === "string") {
    throw new Error("the general proxy matcher rule is gone");
  }
  return entry.source;
}

describe("static asset prefixes", () => {
  it("names only directories that exist under public/", () => {
    for (const prefix of STATIC_ASSET_PREFIXES) {
      expect(existsSync(join(ROOT, "public", prefix))).toBe(true);
    }
  });

  // The `/pal` trap: public/pal/ holds the mascot art AND app/pal/ renders a
  // page. Excluding it would serve that document with no nonce.
  it("refuses a prefix an app route also owns", () => {
    for (const prefix of STATIC_ASSET_PREFIXES) {
      expect(existsSync(join(ROOT, "app", prefix))).toBe(false);
    }
    expect(existsSync(join(ROOT, "app", "pal"))).toBe(true);
    expect(existsSync(join(ROOT, "public", "pal"))).toBe(true);
    expect(STATIC_ASSET_PREFIXES).not.toContain("pal");
  });

  // Next only reads a matcher it can analyse statically, so proxy.ts writes the
  // alternation out as a literal. This is what keeps that literal honest.
  it("is the alternation proxy.ts's matcher literal excludes", () => {
    expect(generalMatcherSource()).toContain(staticAssetMatcherAlternatives());
  });

  it("keeps every static prefix out of the proxy on the canonical host", () => {
    for (const prefix of STATIC_ASSET_PREFIXES) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://pubmaxxing.com/${prefix}/anything.json`,
        }),
      ).toBe(false);
    }
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "https://pubmaxxing.com/data/uk_base/packs/10147e7012acbc91/51.50_-0.25.json",
      }),
    ).toBe(false);
  });

  it("still runs the proxy on every document, /pal included", () => {
    for (const path of ["/", "/map", "/pal", "/login", "/tonight", "/u/you"]) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://pubmaxxing.com${path}`,
        }),
      ).toBe(true);
    }
  });

  it("answers for a path under a prefix and not for a name that merely starts with one", () => {
    expect(isStaticAssetPath("/data/tfl_lines.json")).toBe(true);
    expect(isStaticAssetPath("/fonts/SpaceGrotesk-Bold.ttf")).toBe(true);
    expect(isStaticAssetPath("/database")).toBe(false);
    expect(isStaticAssetPath("/data")).toBe(false);
    expect(isStaticAssetPath("/landing-page")).toBe(false);
    expect(isStaticAssetPath("/pal/chat")).toBe(false);
  });

  it("hands next.config.mjs one header source per prefix", () => {
    expect(staticAssetHeaderSources()).toEqual(
      STATIC_ASSET_PREFIXES.map((prefix) => `/${prefix}/:path*`),
    );
  });

  // The legacy Llandudno generation moved OUT of proxy.ts with the rest of
  // /data. It has to still be answered, so it is a build-time rewrite now.
  it("answers the legacy UK base generation by a routing rewrite, not a function", () => {
    const proxySource = readFileSync(join(ROOT, "proxy.ts"), "utf8");
    expect(proxySource).not.toContain("e229e760f3e7a2fd");
    const configSource = readFileSync(join(ROOT, "next.config.mjs"), "utf8");
    expect(configSource).toContain("e229e760f3e7a2fd");
    expect(configSource).toContain("async rewrites()");
  });
});
