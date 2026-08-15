import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// WHAT A PUBLIC ASSET IS ALLOWED TO BE CACHED FOR.
//
// Everything under /_next/static carries a content hash in its URL, so Next
// already serves it immutable and nothing here is about those. Everything in
// public/ has a FIXED url instead: the brand marks, the share card, the two
// render-blocking boot scripts in <head>, the manifest, the dataset. Without a
// header of our own each of those is served `max-age=0, must-revalidate`,
// which is a conditional round trip per asset per page view — and the boot
// scripts are render-blocking, so that round trip sits in front of first
// paint.
//
// TWO RULES, and they pull opposite ways, which is why they are pinned
// together:
//   1. an unhashed asset may be cached hard at the EDGE (Vercel purges the CDN
//      on every deploy) and only modestly in the BROWSER, which no deploy can
//      reach — so `immutable` is refused outright here. A pinned retired icon
//      or a pinned retired boot script is a bug nobody can clear remotely.
//   2. a service worker and its offline document may never outlive the deploy
//      that shipped them, because a stale worker keeps answering from its OWN
//      cache and a CDN purge does not reach it. They revalidate every time.
//
// The config is evaluated the way Next evaluates it (in Node) rather than read
// as text, so this also proves the config still runs.
const REPO_ROOT = join(__dirname, "..");

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

function configHeaders(): HeaderRule[] {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]);" +
        "console.log(JSON.stringify(await m.default.headers()));",
      join(REPO_ROOT, "next.config.mjs"),
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(out) as HeaderRule[];
}

const rules = configHeaders();

/** The Cache-Control the LAST matching rule sets, which is the one that wins. */
function cacheControlFor(pathname: string): string | null {
  let winner: string | null = null;
  for (const rule of rules) {
    if (!matches(rule.source, pathname)) continue;
    const header = rule.headers.find((h) => h.key.toLowerCase() === "cache-control");
    if (header) winner = header.value;
  }
  return winner;
}

/**
 * The subset of Next's `source` syntax these rules use: a `:name(regex)`
 * segment, a `:name*` catch-all, and literal text. Scanned token by token,
 * because escaping the literals after substituting the groups would escape the
 * groups' own regex too.
 */
function matches(source: string, pathname: string): boolean {
  const token = /\/:[A-Za-z0-9_]+\*|:[A-Za-z0-9_]+\(((?:[^()]|\([^()]*\))*)\)/g;
  let pattern = "";
  let cursor = 0;
  for (let m = token.exec(source); m; m = token.exec(source)) {
    pattern += source.slice(cursor, m.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern += m[0].endsWith("*") ? "(?:/.*)?" : `(?:${m[1]})`;
    cursor = m.index + m[0].length;
  }
  pattern += source.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${pattern}$`).test(pathname);
}

const PUBLIC_DIR = join(REPO_ROOT, "public");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The dataset has its own long-standing rule and its own reasoning.
      if (relative(PUBLIC_DIR, full) === "data") continue;
      walk(full, acc);
    } else {
      acc.push(`/${relative(PUBLIC_DIR, full)}`);
    }
  }
  return acc;
}

const publicFiles = walk(PUBLIC_DIR);

/** Requested on essentially every page view, so a round trip each is a bill. */
const EVERY_PAGE_VIEW = [
  "/theme-init.js",
  "/splash-init.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon-v2.png",
  "/icon-192.png",
  "/icon-512.png",
];

/** Must never outlive its deploy. */
const WORKERS = ["/sw.js", "/sw-plan-cache.js", "/offline.html"];

const MAX_BROWSER_SECONDS = 24 * 60 * 60;

function directive(value: string, name: string): number | null {
  const match = new RegExp(`(?:^|,)\\s*${name}=(\\d+)`).exec(value);
  return match ? Number(match[1]) : null;
}

describe("public asset caching", () => {
  it("caches the assets every page view asks for", () => {
    for (const file of EVERY_PAGE_VIEW) {
      const value = cacheControlFor(file);
      expect(value, `${file} must declare a Cache-Control`).toBeTruthy();
      expect(directive(value ?? "", "s-maxage"), `${file} needs an edge window`).toBeGreaterThan(
        MAX_BROWSER_SECONDS,
      );
    }
  });

  it("never pins an unhashed asset in a browser it cannot reach", () => {
    for (const file of [...EVERY_PAGE_VIEW, "/data/venues_slim.json"]) {
      const value = cacheControlFor(file) ?? "";
      expect(value, `${file} must not be immutable`).not.toMatch(/immutable/);
      const browser = directive(value, "max-age");
      expect(browser, `${file} needs a browser window`).not.toBeNull();
      expect(browser ?? Infinity).toBeLessThanOrEqual(MAX_BROWSER_SECONDS);
    }
  });

  it("keeps every worker and its offline document revalidating", () => {
    for (const file of WORKERS) {
      const value = cacheControlFor(file) ?? "";
      expect(`${file}: ${value}`).toBe(`${file}: public, max-age=0, must-revalidate`);
    }
  });

  it("names only files that are really shipped", () => {
    const shipped = new Set(publicFiles);
    for (const file of [...EVERY_PAGE_VIEW, ...WORKERS]) {
      expect(shipped.has(file), `${file} is not in public/`).toBe(true);
    }
  });

  it("leaves the security headers on every path", () => {
    const everywhere = rules.filter((rule) => rule.source === "/:path*");
    const keys = everywhere.flatMap((rule) => rule.headers.map((h) => h.key));
    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("X-Content-Type-Options");
  });
});
