import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The desktop map's arrival chrome after the 7 Sep live walk (B9). Eighteen
// interactive controls at 1440 before a pin was tapped, against four on the
// phone. The browser fence (e2e/map-desktop-arrival-chrome.spec.ts) counts the
// rendered set; this one holds each control to the home it moved into, so a
// later commit cannot quietly put it back on the arrival row.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const toolbarSource = read("components/map/MapToolbar.tsx");
const kindFilterSource = read("components/map/MapVenueKindFilter.tsx");
const layersSource = read("components/map/MapLayersControl.tsx");
const canvasSource = read("components/PubMapCanvas.tsx");
const bannerStagingCss = read("components/map/mapBannerStaging.css");
const chipsSource = read("components/map/TonightArcChips.tsx");

describe("the toolbar row carries the arrival set only", () => {
  it("hands 'Show me' and the zone picker to the Filters popover", () => {
    expect(toolbarSource).not.toContain("mapToolbarLensBtn");
    expect(toolbarSource).not.toContain("<ZonePicker");
    expect(kindFilterSource).toContain("MapExperienceLensControl");
    expect(kindFilterSource).toContain("ZonePicker");
  });

  it("hands the drink filters to the control that already names the drink", () => {
    expect(toolbarSource).not.toContain("mapToolbarDrinksBtn");
  });

  it("keeps its own weather chip off the map", () => {
    // The rail is the conditions home at every width the rail mounts at, and
    // 641 to 1023 keeps the toolbar chip. What goes is the second copy.
    expect(toolbarSource).not.toContain("<ConditionsChip />");
  });
});

describe("the camera actions live in the Layers popover", () => {
  it("moves 'Show all' and the compass off the map edge", () => {
    // The map-edge group is left holding the route recenter, and only while a
    // route exists, so at arrival it renders nothing at all.
    const edgeGroup =
      canvasSource.match(
        /<div className="mapCameraControls"[\s\S]*?<\/div>/,
      )?.[0] ?? "";
    expect(edgeGroup).not.toBe("");
    expect(edgeGroup).not.toContain("mapFitLondonBtn");
    expect(edgeGroup).not.toContain("mapCompassBtn");
    expect(canvasSource).toMatch(/\{canRecenter \? \([\s\S]{0,200}?mapCameraControls/);

    // Both are inside the Layers popover instead.
    expect(canvasSource).toContain("cameraActions={mapViewActions}");
    expect(layersSource).toContain("cameraActions");
  });
});

describe("one banner at a time, and the first-visit strip is the first of them", () => {
  it("stands the rail, the closure banner and the Pub Pal chip down", () => {
    const block =
      bannerStagingCss.match(
        /body:has\(\.mapArrivalCard\)[\s\S]*?display:\s*none;/,
      )?.[0] ?? "";
    expect(block).toContain(".citySuggestBanner");
    expect(block).toContain(".cityStatusBanner");
    expect(block).toContain(".desktopRail");
    expect(block).toContain(".palSummon");
    expect(block).toContain(".mapConciergeAsk");
  });
});

describe("a chip nobody can press is not a chip", () => {
  it("drops Clubs, because the map's own filter has no club lane", () => {
    // lib/venueKindFilters.ts maps a club venue to null, so `filterVenuesByKind`
    // leaves it off the map entirely. The chip could never be enabled: it was a
    // permanently disabled control explained by a `title` no phone shows.
    expect(chipsSource).not.toContain('label: "Clubs"');
    expect(chipsSource).not.toContain("are not mapped yet");
  });
});
