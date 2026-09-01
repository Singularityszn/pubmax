// A shared cache holds ONE answer for everybody, so only a route whose answer
// is the same for everybody may ask for one.
//
// U6 of docs/plans/SITE_SPEED_2026-09-01.md. The rule this fence keeps is
// narrower than "is it public": a body that is a pure function of the request
// URL and the deployment may sit at the edge, and everything else may not -
// a session, a caller's identity, a store read that can change between two
// requests, or a URL that can carry the viewer's own coordinates.
//
// That last one is the trap. /api/tonight-conditions is public and read-only
// and still may not be cached: its URL carries lat and lng, so a shared cache
// key would hold a viewer's point. It stays no-store, and the reason is written
// down here rather than left to the next reader's judgement.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const API_ROOT = join(REPO_ROOT, "app/api");

function routeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry === "route.ts" || entry === "route.tsx") found.push(full);
    }
  };
  walk(API_ROOT);
  return found;
}

/** Anything that makes an answer differ between two callers of the same URL. */
const PER_CALLER_READS = [
  "callerUserId",
  "requireLinkedActor",
  "resolveMessageHandle",
  "gateHandleAction",
  "verifySupabaseSessionFromRequest",
  "isModerator",
  "cookies()",
];

/** A URL that can carry where the reader is standing. */
const VIEWER_POINT_READS = ["coarsenViewerPoint", 'searchParams.get("lat")'];

/**
 * Two routes that already shipped a shared-cache header over a coarsened viewer
 * point, and are NOT this unit's to change: /api/tfl-disruption caches 60s and
 * /api/citymcp/journey caches its own window, both keyed on a URL carrying
 * lat and lng. Whether a coarsened point may sit in a shared cache key is a
 * product call above an implementation lane, so they are named here with the
 * finding rather than quietly changed or quietly allowed.
 *
 * This list may only ever SHRINK. Anything new that wants to join it is a
 * decision somebody has to make on purpose.
 */
const VIEWER_POINT_CACHE_ESCALATED = new Set([
  "app/api/tfl-disruption/route.ts",
  "app/api/citymcp/journey/route.ts",
]);

function sharedCached(source: string): boolean {
  return source.includes("jsonCached") || source.includes("s-maxage");
}

describe("only a route with one answer may take a shared cache", () => {
  const files = routeFiles();

  it("finds the API tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("never puts a per-caller answer at the edge", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!sharedCached(source)) continue;
      const reads = PER_CALLER_READS.filter((read) => source.includes(read));
      if (reads.length > 0) {
        offenders.push(`${file.slice(REPO_ROOT.length + 1)}: ${reads.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never puts a viewer's own point in a shared cache key", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!sharedCached(source)) continue;
      const relative = file.slice(REPO_ROOT.length + 1);
      if (VIEWER_POINT_CACHE_ESCALATED.has(relative)) continue;
      const reads = VIEWER_POINT_READS.filter((read) => source.includes(read));
      if (reads.length > 0) offenders.push(`${relative}: ${reads.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the escalated pair a closed, shrinking list", () => {
    // Both must still exist and still be the shape that put them here, or the
    // exception has outlived the finding and should go.
    for (const relative of VIEWER_POINT_CACHE_ESCALATED) {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      expect(sharedCached(source), relative).toBe(true);
      expect(source.includes("coarsenViewerPoint"), relative).toBe(true);
    }
    expect(VIEWER_POINT_CACHE_ESCALATED.size).toBeLessThanOrEqual(2);
  });
});

describe("the routes this unit classified", () => {
  function read(relative: string): string {
    return readFileSync(join(REPO_ROOT, relative), "utf8");
  }

  it("caches a Night Area, list and slug alike", () => {
    // Bundled config: a pure function of the URL and the deploy. The list has
    // said so since it shipped; the slug said no-store for no reason of its own.
    expect(read("app/api/night-areas/route.ts")).toContain("jsonCached");
    expect(read("app/api/night-areas/[slug]/route.ts")).toContain("jsonCached");
  });

  it("leaves the conditions strip uncached, because its URL carries a point", () => {
    const conditions = read("app/api/tonight-conditions/route.ts");
    expect(conditions).toContain("jsonNoStore");
    expect(conditions).not.toContain("jsonCached");
  });
});
