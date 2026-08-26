import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The map's cold open is main-thread bound: what the shell chunk STATICALLY
// imports has to be parsed before MapLibre can even start, so a data blob that
// travels in on a helper's coat-tails costs first paint directly. These fences
// hold the boundary that the measurements were taken against.

const ROOT = join(__dirname, "..");

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Modules reachable from `entry` by STATIC import only. `next/dynamic` and
 * `import()` calls are separate chunks and deliberately not followed - that is
 * the whole point of splitting them.
 */
function staticImportGraph(entry: string): Map<string, string | null> {
  const seen = new Map<string, string | null>([[join(ROOT, entry), null]]);
  const queue = [join(ROOT, entry)];
  while (queue.length) {
    const file = queue.shift() as string;
    if (file.endsWith(".json")) continue;
    let source = "";
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const specs: string[] = [];
    const withBindings =
      /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?)\s*from\s*["']([^"']+)["']/g;
    const sideEffect = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = withBindings.exec(source))) specs.push(match[1]);
    while ((match = sideEffect.exec(source))) specs.push(match[1]);
    for (const spec of specs) {
      const resolved = resolveSpec(spec, file);
      if (!resolved || seen.has(resolved)) continue;
      seen.set(resolved, file);
      queue.push(resolved);
    }
  }
  return seen;
}

function chainTo(graph: Map<string, string | null>, target: string): string {
  const steps: string[] = [];
  let cursor: string | null | undefined = target;
  while (cursor) {
    steps.unshift(cursor.replace(`${ROOT}/`, ""));
    cursor = graph.get(cursor);
  }
  return steps.join(" -> ");
}

describe("map cold-open payload", () => {
  const mapShell = staticImportGraph("components/PubMap.tsx");

  // london_boroughs_simplified.json is 70 KB of polygon geometry that only
  // nearestNightPatch needs. It used to arrive through
  // planningIntent -> nightPatches, so the map parsed every borough outline to
  // read a stored planning intent. lib/nearestNightPatch.ts is the split.
  it("does not pull the borough boundary geometry into the map shell chunk", () => {
    const boundaries = join(ROOT, "data/london_boroughs_simplified.json");
    expect(
      mapShell.has(boundaries) ? chainTo(mapShell, boundaries) : "not reached",
    ).toBe("not reached");
  });

  it("keeps the borough geometry with the one helper that classifies a point", () => {
    const classifier = staticImportGraph("lib/nearestNightPatch.ts");
    expect(classifier.has(join(ROOT, "data/london_boroughs_simplified.json"))).toBe(true);
  });

  it("does not pull persona drink JSON into the map shell chunk", () => {
    const personaJson = join(ROOT, "data/persona_drinks.json");
    expect(
      mapShell.has(personaJson) ? chainTo(mapShell, personaJson) : "not reached",
    ).toBe("not reached");
  });

  it("does not pull AuthProvider into the map shell via usePintDrops", () => {
    const authProvider = join(ROOT, "components/auth/AuthProvider.tsx");
    expect(
      mapShell.has(authProvider) ? chainTo(mapShell, authProvider) : "not reached",
    ).toBe("not reached");
  });

  it("does not pull the curated crawl catalog into the eager map shell chunk", () => {
    const crawls = join(ROOT, "lib/curatedCrawls.ts");
    expect(
      mapShell.has(crawls) ? chainTo(mapShell, crawls) : "not reached",
    ).toBe("not reached");
  });

  it("keeps MobileMapShell out of the eager map shell graph", () => {
    expect(mapShell.has(join(ROOT, "components/mobile/MobileMapShell.tsx"))).toBe(false);
  });

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
