import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import budgetsJson from "@/perf/route-budgets.json";

import { mapLoadingPrimaryLine } from "@/lib/mapLoadingCopy";

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const mapLoadingSkeleton = readFileSync(
  join(process.cwd(), "components/map/MapLoadingSkeleton.tsx"),
  "utf8",
);

describe("map loading chrome", () => {
  it("keeps mobile shell chrome off the held loading frame", () => {
    expect(pubMap).toContain("const mapLoadingActive = !mapCanvasErrored && !pinsRevealed;");
    expect(pubMap).toContain("const mobileShellReady = !mapLoadingActive;");

    const gateIndex = pubMap.indexOf("{mobileShellReady ? (");
    const shellIndex = pubMap.indexOf("<MobileMapShell", gateIndex);

    expect(gateIndex).toBeGreaterThan(-1);
    expect(shellIndex).toBeGreaterThan(gateIndex);
  });

  it("ties the held frame to pin reveal, not merely basemap or slim rows", () => {
    expect(pubMap).toContain("MAP_PIN_REVEAL_EVENT");
    expect(pubMap).toContain("setPinsRevealed(true)");
    expect(pubMap).not.toContain(
      "const mapLoadingActive = !mapCanvasErrored && (!mapCanvasReady || (slimPins.length === 0 && !loaded));",
    );
  });

  it("uses city-aware loading copy on both held frames", () => {
    expect(`${pubMap}\n${mapLoadingSkeleton}`).not.toContain("Fetching tonight");
    expect(`${pubMap}\n${mapLoadingSkeleton}`).not.toContain("Rounding up the pubs");
    expect(pubMap).toContain("mapLoadingPrimaryLine(mapDisplayName)");
    expect(mapLoadingSkeleton).toContain('mapLoadingPrimaryLine("London")');
    expect(mapLoadingPrimaryLine("London")).toBe("Loading London pubs…");
  });

  it("announces an honest slow line after eight seconds", () => {
    expect(pubMap).toContain("MAP_LOADING_SLOW_LINE");
    expect(pubMap).toContain("8_000");
    expect(pubMap).toContain("mapLoadingSlow");
  });

  // The visible loading line is allowed a dry aside (docs/VOICE.md: jokes live
  // in loading lines). The ACCESSIBLE NAME is not: a screen-reader user should
  // hear what is happening, not the joke, so the aria-label states the fact and
  // nothing else.
  it("keeps the held frame's accessible name literal", () => {
    // Scan EVERY aria-label in the file, not the first one that matches: a
    // second held frame with a joke appended to its label has to fail here.
    const labels =
      pubMap.match(/aria-label=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g) ?? [];
    const loadingLabels = labels.filter((label) => label.includes("Loading"));

    expect(loadingLabels.length).toBeGreaterThan(0);
    for (const label of loadingLabels) {
      expect(label).toBe("aria-label={`Loading the ${mapDisplayName} pub map.`}");
    }
  });
});

describe("map pin-ready budget", () => {
  it("records the cold /map/london pin-ready SLA beside the /map route", () => {
    const mapRoute = budgetsJson.routes.find((route) => route.path === "/map");
    expect(mapRoute).toBeDefined();
    const pinReady = (mapRoute as { pinReady?: Record<string, unknown> }).pinReady;
    expect(pinReady?.path).toBe("/map/london");
    expect(pinReady?.targetMs).toBe(5000);
    expect(typeof pinReady?.measuredMs).toBe("number");
    expect((pinReady?.measuredMs as number) > 0).toBe(true);
    expect((pinReady?.measuredMs as number) <= (pinReady?.targetMs as number)).toBe(
      true,
    );
  });
});
