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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import {
  BUILD_WRITTEN_STATIC_ASSET_PREFIXES,
  STATIC_ASSET_PREFIXES,
  isBuildWrittenStaticAssetPrefix,
  isStaticAssetPath,
  staticAssetHeaderSources,
  staticAssetMatcherAlternatives,
} from "@/lib/staticAssetPrefixes.mjs";
import { config } from "@/proxy";

const ROOT = process.cwd();

/**
 * The paths this repository actually HOLDS, read from the commit rather than
 * from the working tree. A fresh `npm ci` checkout is what CI runs the unit
 * suite on, so the working tree is the wrong witness: it also carries every
 * build artifact and every ignored file a developer happens to have lying
 * about, which is how `public/vendor/` passed here for weeks while being
 * absent everywhere the check mattered.
 */
function committedPathsAtHead(): Set<string> {
  return new Set(
    execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean),
  );
}

const COMMITTED_PATHS = committedPathsAtHead();

function hasCommittedBytes(prefix: string): boolean {
  for (const path of COMMITTED_PATHS) {
    if (path.startsWith(`public/${prefix}/`)) return true;
  }
  return false;
}

const PACKAGE_SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
).scripts;

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
  // A prefix earns its place by BYTES THIS REPOSITORY HOLDS, and the witness is
  // the commit. `existsSync` alone was the bug: `public/vendor/` is gitignored
  // build output that `npm run build` writes before `next build`, so it was there on every machine that
  // had ever run the app and absent in the CI unit job, which checks out clean
  // and runs `npx vitest run` with no build in front of it.
  it("names only directories a clean checkout really holds", () => {
    for (const prefix of STATIC_ASSET_PREFIXES) {
      if (isBuildWrittenStaticAssetPrefix(prefix)) continue;
      expect(hasCommittedBytes(prefix), `public/${prefix}/ is committed`).toBe(
        true,
      );
      expect(existsSync(join(ROOT, "public", prefix))).toBe(true);
    }
  });

  // The other half, and the assertion that would have caught this the day the
  // prefix landed: a prefix with no committed bytes has to SAY it is written by
  // the build, and its generator has to be a real script the build really runs.
  it("proves every build-written prefix by its generator, not its bytes", () => {
    for (const prefix of STATIC_ASSET_PREFIXES) {
      expect(
        hasCommittedBytes(prefix) || isBuildWrittenStaticAssetPrefix(prefix),
        `${prefix} is committed or declared build-written`,
      ).toBe(true);
    }

    for (const [prefix, generator] of Object.entries(
      BUILD_WRITTEN_STATIC_ASSET_PREFIXES,
    )) {
      expect(STATIC_ASSET_PREFIXES, prefix).toContain(prefix);
      expect(hasCommittedBytes(prefix), `${prefix} is not committed`).toBe(
        false,
      );
      expect(generator.reason.length).toBeGreaterThan(0);

      // The generator exists, and it writes where it claims to.
      expect(existsSync(join(ROOT, generator.script))).toBe(true);
      const generatorSource = readFileSync(
        join(ROOT, generator.script),
        "utf8",
      );
      expect(generatorSource).toContain('"public"');
      expect(generatorSource).toContain(`"${prefix}"`);

      // And the build really runs it, which is the whole reason a directory
      // absent from the commit is still there for `next build` to serve.
      expect(PACKAGE_SCRIPTS[generator.npmScript]).toContain(generator.script);
      expect(PACKAGE_SCRIPTS.build).toContain(generator.npmScript);
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

  it("keeps webpack-mode HMR off the proxy so the WebSocket can upgrade", () => {
    // Importers: this suite + Next's matcher. Callers: `next dev --webpack`
    // HMR client. Without the exclusion the handshake returns ordinary HTTP
    // (ERR_INVALID_HTTP_RESPONSE) and the app never hydrates.
    expect(generalMatcherSource()).toContain("_next/hmr");
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "https://pubmaxxing.com/_next/hmr?id=test",
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
