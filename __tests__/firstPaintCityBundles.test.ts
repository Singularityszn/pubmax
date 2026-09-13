import { readFileSync } from "node:fs";
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

  it("keeps the datalist the read feeds inside the composer", () => {
    // If the datalist ever moved outside `composerVisible`, the gate above
    // would start hiding a control the reader can see.
    const composerBlock = source.slice(source.indexOf("{composerVisible ? ("));
    expect(composerBlock).toContain('<datalist id="plan-venue-options">');
  });
});
