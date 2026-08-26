import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Runtime decoded-JS proof lives in e2e/map-perf-budget.spec.ts. These fences
// hold interaction-gated dynamic imports and deferred fetch timing in source.

const ROOT = join(__dirname, "..");

describe("map cold-open payload", () => {
  // Every venue sheet / list / planner surface stays behind next/dynamic, so
  // none of them is parsed before the map can draw.
  it.each([
    "components/map/VenueInspector",
    "components/map/MapVenueList",
    "components/map/RoutePanel",
    "components/map/MapToolbar",
    "components/map/UnverifiedPubSheet",
  ])("loads %s dynamically rather than in the eager map chunk", (moduleId) => {
    const source = readFileSync(join(ROOT, "components/PubMap.tsx"), "utf8");
    expect(source).toContain(`import("@/${moduleId}")`);
    // A type-only import is erased at build time, so it is not a value edge.
    const valueImport = new RegExp(
      `^import\\s+(?!type\\s)[A-Za-z{][^\\n]*from\\s+"@/${moduleId}";`,
      "m",
    );
    expect(valueImport.test(source)).toBe(false);
  });

  // The 2.1 MB national Wetherspoon directory answers the Open now filter and
  // nothing on the first frame. Fetched at mount it queued ahead of the slim
  // venue shard and then parsed on the main thread during MapLibre's init.
  it("holds the Wetherspoon directory fetch until the canvas hands over", () => {
    const source = readFileSync(join(ROOT, "components/PubMap.tsx"), "utf8");
    const effect = source.slice(
      source.indexOf("loadWetherspoonsDirectory()") - 600,
      source.indexOf("loadWetherspoonsDirectory()"),
    );
    expect(effect).toContain("if (!mapCanvasReady && !filters.openNow) return;");
  });

  // The tab bar is in the viewport on every non-root phone route, so Next's
  // automatic Link prefetch fired for all six destinations while it painted.
  // Its own pointer/hover warm and the gated background warm replace it.
  it("does not force automatic Link prefetch from the mobile tab bar", () => {
    const source = readFileSync(join(ROOT, "components/nav/MobileTabBar.tsx"), "utf8");
    expect(source).toContain("prefetch={false}");
    expect(source).not.toMatch(/^\s*prefetch\s*$/m);
    expect(source).not.toContain("warmPrimaryTabRoutes");
  });
});
