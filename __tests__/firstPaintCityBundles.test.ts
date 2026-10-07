import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * NOTHING CITY-WIDE IS FETCHED FOR AN ANSWER NOBODY ASKED.
 *
 * Three committed packs are big enough to be the whole of a route's weight, and
 * each was being read on mount by a surface that would not draw it. Measured on
 * the audit's own phone rig (390x844, 4x CPU, Slow 4G) against a production
 * build, decoded bytes per route on a cold visit:
 *
 *   /map                     9092 KB, of which /data/wetherspoons/pubs.json
 *                            was 2098 KB and only the Open now filter reads it;
 *   /map?sel=<id>           15032 KB, of which the drink and food price-update
 *                            overlays were 1862 KB and 1519 KB and only the
 *                            Drinks tab draws them;
 *   /plan                    3554 KB, of which two reads of the 911 KB slim
 *                            venue index were 1821 KB and only the composer's
 *                            own Stop rows use it, which describe-first has not
 *                            drawn.
 *
 * These are SOURCE fences rather than browser assertions on purpose. A byte
 * saving of this shape is one condition in one effect, and a browser test would
 * prove the condition on one route on one network while leaving the next mount
 * free to re-add the read. docs/proof/map-bytes-first-pin/ holds the measured
 * before and after.
 */

const ROOT = path.join(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** Every component source the browser can load, as repo-relative paths. */
function browserSources(): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/u.test(entry.name)) found.push(next);
    }
  };
  walk("components");
  return found;
}

/** The `useEffect(...)` call whose body contains `marker`. */
function effectContaining(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `expected to find ${marker}`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("useEffect(", at);
  expect(start, `expected ${marker} to sit inside a useEffect`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start + "useEffect".length; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced useEffect around ${marker}`);
}

describe("the Wetherspoon directory is the Open now filter's own read", () => {
  const source = read("components/PubMap.tsx");
  const effect = effectContaining(source, "loadWetherspoonsDirectory()");

  it("refuses to fetch 2.1 MB of national hours unless Open now is on", () => {
    expect(effect).toContain("if (!filters.openNow) return;");
  });

  it("no longer reads the canvas as a reason to fetch it", () => {
    // Holding it behind the canvas kept it off the first pin's wire and still
    // spent it on every reader. The filter is the only thing that reads it.
    expect(effect).not.toContain("mapCanvasReady");
  });

  it("keeps the filter as the effect's only dependency", () => {
    expect(effect).toMatch(/\}, \[filters\.openNow\]\)$/);
  });
});

describe("the price-update overlays are the open pub's own read", () => {
  // #1657 moved this read to the server. The tab used to fetch both national
  // packs on mount and draw a handful of rows about one pub; the venue detail
  // the sheet fetches anyway now carries that pub's own rows, scoped by the
  // keys it answers to. So the fence is no longer a gate inside an effect: it
  // is that the scope lives on the server and the browser owns no pack read.
  const route = read("app/api/venue/[id]/route.ts");
  const tab = read("components/map/inspector/VenueMenuTab.tsx");

  it("scopes both packs to the open pub, on the server", () => {
    expect(route).toContain("venuePriceUpdatesFor(venueMenuLookupKeys(venue))");
    expect(route).toContain('from "@/lib/priceUpdates.server"');
  });

  it("draws them off that answer, and fetches nothing of its own", () => {
    expect(tab).toContain("venuePriceUpdatesOf(venue)");
    expect(tab).not.toContain("fetch(");
    expect(tab).not.toContain("priceUpdatesLoader");
  });

  it("leaves no browser module reading either national pack", () => {
    // 1862 KB and 1519 KB. A read of one of these from a client component is
    // the defect whatever component it moves into, so the scan is the whole
    // browser tree rather than the one tab it landed in.
    const packs = /\/data\/(drink|food)_price_updates/u;
    const readers = browserSources().filter((file) => packs.test(read(file)));
    expect(readers).toEqual([]);
  });

  it("draws the panel hidden rather than unmounted, which is why the gate was needed", () => {
    // Every tab is mounted on every sheet open and hides itself; that is what
    // made a mount-time effect a read for a tab nobody had opened, and it is
    // why the read may not be the browser's at all.
    expect(tab).toContain('hidden={tab !== "menu"}');
  });
});

describe("the plan venue index is the composer's own read", () => {
  const source = read("components/plan/PlanComposer.tsx");
  const effect = effectContaining(
    source,
    "planComposerVenueIndexPath(acceptedCityId)",
  );

  it("waits until the composer that uses the list is on screen", () => {
    expect(effect).toContain("if (!composerVisible) return;");
    expect(effect).toContain("composerVisible, acceptedCityId");
  });
});
