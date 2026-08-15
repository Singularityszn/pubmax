import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const PUBLIC_DIR = join(REPO_ROOT, "public");

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const EDITED_IN_PLACE_CACHE =
  "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800";
const SHORT_EDGE_CACHE = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const REVALIDATE_CACHE = "public, max-age=0, must-revalidate";

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

function matches(source: string, pathname: string): boolean {
  const token = /\/:[A-Za-z0-9_]+\*|:[A-Za-z0-9_]+\(((?:[^()]|\([^()]*\))*)\)/g;
  let pattern = "";
  let cursor = 0;
  for (let match = token.exec(source); match; match = token.exec(source)) {
    pattern += source.slice(cursor, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern += match[0].endsWith("*") ? "(?:/.*)?" : `(?:${match[1]})`;
    cursor = match.index + match[0].length;
  }
  pattern += source.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${pattern}$`).test(pathname);
}

function cacheControlFor(pathname: string): string | null {
  let winner: string | null = null;
  for (const rule of rules) {
    if (!matches(rule.source, pathname)) continue;
    const header = rule.headers.find(
      (candidate) => candidate.key.toLowerCase() === "cache-control",
    );
    if (header) winner = header.value;
  }
  return winner;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(`/${relative(PUBLIC_DIR, full).split(sep).join("/")}`);
  }
  return acc;
}

const publicFiles = walk(PUBLIC_DIR);
const filesOutsideData = publicFiles.filter((file) => !file.startsWith("/data/"));

const LANDING_IMAGE_PATTERN = /\.(?:avif|webp|jpg)$/i;
const CLASS_A_PREFIXES = ["/fonts/", "/night-signals/"];
const CLASS_A_PROBES = [
  "/fonts/example.woff2",
  "/landing/hero-thames-1600.avif",
  "/night-signals/example.svg",
];
const CLASS_A = filesOutsideData.filter((file) =>
  CLASS_A_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
  (file.startsWith("/landing/") && LANDING_IMAGE_PATTERN.test(file)),
);

const CLASS_B = filesOutsideData.filter(
  (file) =>
    (file.startsWith("/landing/") && !LANDING_IMAGE_PATTERN.test(file)) ||
    file.startsWith("/vendor/") ||
    file.startsWith("/store-assets/") ||
    file.startsWith("/brand/") ||
    /^\/(?:icon-|apple-touch-icon|favicon)/.test(file) ||
    ["/theme-init.js", "/splash-init.js", "/manifest.webmanifest"].includes(file),
);

const CLASS_C = ["/llms.txt"];
const WORKERS = ["/sw.js", "/sw-plan-cache.js", "/offline.html"];

const BUILD_WRITTEN_FIXED_URLS = [
  {
    prefix: "/vendor/maplibre/",
    probe: "/vendor/maplibre/maplibre-gl-worker.mjs",
    reason: "prebuild overwrites fixed MapLibre worker module URLs",
  },
  {
    prefix: "/store-assets/png/",
    probe: "/store-assets/png/ios/AppIcon-1024.png",
    reason: "store export generation overwrites fixed PNG URLs",
  },
] as const;

const DELIBERATE_OMISSIONS = new Map([
  [
    "/.well-known/apple-app-site-association",
    "Apple universal-link metadata keeps platform-controlled revalidation semantics.",
  ],
]);

describe("public asset caching", () => {
  it("gives content-stable assets the immutable class", () => {
    expect(CLASS_A.length).toBeGreaterThan(0);
    for (const file of [...CLASS_A, ...CLASS_A_PROBES]) {
      expect(cacheControlFor(file), file).toBe(IMMUTABLE_CACHE);
    }
  });

  it("gives files edited in place a short browser and long edge window", () => {
    expect(cacheControlFor("/data/venues_slim.json")).toBe(EDITED_IN_PLACE_CACHE);
    for (const file of CLASS_B) expect(cacheControlFor(file), file).toBe(EDITED_IN_PLACE_CACHE);
  });

  it("keeps crawler text revalidating in the browser", () => {
    for (const file of CLASS_C) expect(cacheControlFor(file), file).toBe(SHORT_EDGE_CACHE);
  });

  it("keeps workers and their offline document revalidating", () => {
    for (const file of WORKERS) expect(cacheControlFor(file), file).toBe(REVALIDATE_CACHE);
  });

  it("never marks an edited-in-place or crawler asset immutable", () => {
    for (const file of [...CLASS_B, ...CLASS_C, "/data/venues_slim.json"]) {
      expect(cacheControlFor(file) ?? "", file).not.toContain("immutable");
    }
  });

  it("keeps public text mutable while landing images stay immutable", () => {
    expect(cacheControlFor("/landing/ATTRIBUTION.md")).toBe(EDITED_IN_PLACE_CACHE);
    expect(cacheControlFor("/landing/hero-thames-1600.avif")).toBe(IMMUTABLE_CACHE);

    const textFiles = publicFiles.filter((file) => /\.(?:md|txt)$/i.test(file));
    for (const file of textFiles) {
      expect(cacheControlFor(file) ?? "", file).not.toContain("immutable");
    }
  });

  it("keeps every build-written fixed URL out of the immutable class", () => {
    for (const generated of BUILD_WRITTEN_FIXED_URLS) {
      const files = [
        generated.probe,
        ...filesOutsideData.filter((file) => file.startsWith(generated.prefix)),
      ];
      for (const file of new Set(files)) {
        expect(cacheControlFor(file), `${file}: ${generated.reason}`).toBe(
          EDITED_IN_PLACE_CACHE,
        );
      }
    }
  });

  it("classifies every shipped public file outside data", () => {
    const classes = [CLASS_A, CLASS_B, CLASS_C, WORKERS];
    for (const file of filesOutsideData) {
      const memberships = classes.filter((assetClass) => assetClass.includes(file)).length;
      if (DELIBERATE_OMISSIONS.has(file)) {
        expect(memberships, `${file}: ${DELIBERATE_OMISSIONS.get(file)}`).toBe(0);
      } else {
        expect(memberships, `${file} must belong to exactly one cache class`).toBe(1);
      }
    }
    for (const [file, reason] of DELIBERATE_OMISSIONS) {
      expect(reason.trim().length, `${file} needs an omission reason`).toBeGreaterThan(0);
      expect(filesOutsideData, `${file} is no longer shipped`).toContain(file);
    }
  });

  it("leaves security headers on every path", () => {
    const everywhere = rules.filter((rule) => rule.source === "/:path*");
    const keys = everywhere.flatMap((rule) => rule.headers.map((header) => header.key));
    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("X-Content-Type-Options");
  });
});
