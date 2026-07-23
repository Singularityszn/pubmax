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
    expect(pubMap).toContain("Finding the pubs. Warming up the map.");
    expect(mapLoadingSkeleton).toContain("Finding the pubs. Warming up the map.");
  });
});
