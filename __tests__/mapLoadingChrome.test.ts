import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const mapLoadingSkeleton = readFileSync(
  join(process.cwd(), "components/map/MapLoadingSkeleton.tsx"),
  "utf8",
);

describe("map loading chrome", () => {
  it("keeps mobile shell chrome off the held loading frame", () => {
    expect(pubMap).toContain(
      "const mapLoadingActive = !mapCanvasErrored && (!mapCanvasReady || (slimPins.length === 0 && !loaded));",
    );
    expect(pubMap).toContain("const mobileShellReady = !mapLoadingActive;");

    const gateIndex = pubMap.indexOf("{mobileShellReady ? (");
    const shellIndex = pubMap.indexOf("<MobileMapShell", gateIndex);

    expect(gateIndex).toBeGreaterThan(-1);
    expect(shellIndex).toBeGreaterThan(gateIndex);
  });

  it("does not claim first paint waits on tonight's prices", () => {
    expect(`${pubMap}\n${mapLoadingSkeleton}`).not.toContain("Fetching tonight");
    // Both surfaces carry the SAME visible line so the route-level skeleton
    // hands off to PubMap's own held frame without the copy jumping.
    expect(pubMap).toContain("Rounding up the pubs.");
    expect(mapLoadingSkeleton).toContain("Rounding up the pubs.");
  });

  // The visible loading line is allowed a dry aside (docs/VOICE.md: jokes live
  // in loading lines). The ACCESSIBLE NAME is not: a screen-reader user should
  // hear what is happening, not the joke, so the aria-label states the fact and
  // nothing else.
  it("keeps the held frame's accessible name literal", () => {
    expect(pubMap).toContain("aria-label={`Loading the ${city.displayName} venue map.`}");
    const label = pubMap.match(/aria-label=\{`Loading the \$\{city\.displayName\} venue map\.[^`]*`\}/);
    expect(label?.[0]).toBe("aria-label={`Loading the ${city.displayName} venue map.`}");
  });
});
