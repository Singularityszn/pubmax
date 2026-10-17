// What the root shell may pull into the bundle every page downloads.
//
// The components app/layout.tsx mounts ride every route, so whatever they reach
// through STATIC imports is parsed before any page is useful. Measured on a
// production build at 390px on 17 October 2026, every route shipped about
// 900 KB of decoded script before its own code, and about 420 KB of it was app
// code most pages never draw: the analytics consent prompt read one boolean out
// of lib/mapFirstVisitArrival.ts and dragged in the venue index, the shard
// loader, route legs, culture crawls and community prices with it; the
// analytics allowlist read the night-area slugs out of lib/nightAreas.ts and
// took every area's prose and the city pack JSON; and AuthProvider mounted the
// handle claim and the founders' welcome for strangers who can never see them.
//
// The walk follows `import`/`export ... from` and skips `import type` and
// `import()`, which is exactly the line between the eager bundle and a lazy
// chunk. A module named here may still be used by the shell, through a dynamic
// import, once the thing it draws is on screen.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(REPO_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;

function staticImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT)) {
    if (match[1]) continue;
    const resolved = resolveImport(file, match[2] ?? "");
    if (resolved) found.push(resolved);
  }
  return found;
}

/** Every module app/layout.tsx reaches eagerly, with the edge that reached it. */
function rootShellGraph(): Map<string, string | null> {
  const layout = join(REPO_ROOT, "app/layout.tsx");
  const reachedFrom = new Map<string, string | null>([[layout, null]]);
  const queue = [layout];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!/\.(?:ts|tsx|mjs|js)$/.test(file)) continue;
    for (const next of staticImports(file)) {
      if (reachedFrom.has(next)) continue;
      reachedFrom.set(next, file);
      queue.push(next);
    }
  }
  return reachedFrom;
}

function chainTo(graph: Map<string, string | null>, target: string): string {
  const chain: string[] = [];
  for (let at: string | null | undefined = target; at; at = graph.get(at)) {
    chain.unshift(relative(REPO_ROOT, at));
  }
  return chain.join(" -> ");
}

const KEPT_OUT_OF_THE_SHELL = [
  // The map's own library: the venue index, its shards and what they rank with.
  "lib/pubMap.ts",
  "lib/venues.ts",
  "lib/curation.ts",
  "lib/slimShards.ts",
  "lib/londonVenueShards.ts",
  "lib/nearMeAnswer.ts",
  "lib/routeLegs.ts",
  "lib/communityPrice.ts",
  "lib/mapFirstVisitArrival.ts",
  // Planner vocabulary and the crawls built on it.
  "lib/planOccasion.ts",
  "lib/cultureCrawl.ts",
  // Night areas with their prose and the derived city pack.
  "lib/nightAreas.ts",
  // Account overlays only a signed-in reader can see.
  "components/auth/ArrivalWelcome.tsx",
  "components/identity/AccountOnboarding.tsx",
  "lib/foundingMembers.ts",
];

describe("the root shell's eager import graph", () => {
  const graph = rootShellGraph();

  it("walks a real graph rather than an empty one", () => {
    // The shell's own pieces must be found, or a broken walk would pass.
    for (const file of ["components/auth/AuthProvider.tsx", "components/nav/MobileTabBar.tsx", "lib/promptBudget.ts"]) {
      expect(graph.has(join(REPO_ROOT, file)), file).toBe(true);
    }
  });

  it.each(KEPT_OUT_OF_THE_SHELL)("does not reach %s", (file) => {
    const target = join(REPO_ROOT, file);
    expect(existsSync(target), `${file} no longer exists; drop it from the list`).toBe(true);
    expect(graph.has(target), chainTo(graph, target)).toBe(false);
  });

  it("still reads the consent gate and the slug vocabulary through their leaves", () => {
    expect(graph.has(join(REPO_ROOT, "lib/mapFirstVisitArrivalGate.ts"))).toBe(true);
    expect(graph.has(join(REPO_ROOT, "lib/nightAreaSlugs.ts"))).toBe(true);
  });
});
