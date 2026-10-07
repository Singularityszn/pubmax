// The map's ODbL credit stays on the map's licence line, and leaves the phone's
// resting layers.
//
// History. UI audit, 2026-09-01, production, 390x844: four info glyphs rendered
// stacked on a white rounded blob, because raising MapLibre's 24px button to the
// 44px tap floor tiled its 24px background glyph 2 x 2. That was fixed by
// shaping the control. The phone map then rested on seven layers, and the
// compact (i) was one of them (docs/rules/components-sheets-chrome-and-navigation.md,
// "THE PHONE MAP RESTS ON THREE LAYERS"): it is no longer painted on a phone,
// and the same credit is the first copy in More map controls > Key.
//
// What may NOT change is the credit itself: OSM_ATTRIBUTION is still passed as
// customAttribution on the map, so it survives every style swap and every
// city, and the phone's copy reads the same constant.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { OSM_ATTRIBUTION } from "@/components/map/canvas/tokens";
import MapCredits from "@/components/map/MapCredits";

const REPO_ROOT = join(__dirname, "..");
const shellCss = readFileSync(
  join(REPO_ROOT, "components/mobile/mobileMapShell.css"),
  "utf8",
);
const canvasTsx = readFileSync(
  join(REPO_ROOT, "components/PubMapCanvas.tsx"),
  "utf8",
);
const pubMapTsx = readFileSync(join(REPO_ROOT, "components/PubMap.tsx"), "utf8");

function phoneRuleFor(selector: string): string {
  const phone = shellCss.indexOf("@media (max-width: 640px)");
  expect(phone, "phone block present").toBeGreaterThan(-1);
  const at = shellCss.indexOf(selector, phone);
  expect(at, `${selector} present in the phone block`).toBeGreaterThan(-1);
  const open = shellCss.indexOf("{", at);
  return shellCss.slice(open, shellCss.indexOf("}", open));
}

describe("the phone map does not paint the credit control", () => {
  it("hides MapLibre's bottom-right lane from 640px down, and only there", () => {
    const rule = phoneRuleFor(".appShell .mapStage .maplibregl-ctrl-bottom-right");
    expect(rule).toContain("display: none;");
    // The desktop rule block starts above the phone block and must not hide it.
    const desktop = shellCss.slice(0, shellCss.indexOf("@media (max-width: 640px)"));
    expect(desktop).not.toContain("maplibregl-ctrl-bottom-right");
  });

  it("keeps the control mounted, so customAttribution survives every style swap", () => {
    expect(canvasTsx).toContain("customAttribution: OSM_ATTRIBUTION,");
  });
});

describe("the credit itself is unchanged", () => {
  it("still rides the map as customAttribution", () => {
    expect(OSM_ATTRIBUTION).toContain("OpenStreetMap contributors");
    expect(OSM_ATTRIBUTION).toContain("ODbL");
  });

  it("reads the same constant in the phone's copy, with the basemap's own line", () => {
    const html = renderToStaticMarkup(createElement(MapCredits));
    expect(html).toContain("Map credits");
    expect(html).toContain(OSM_ATTRIBUTION);
    expect(html).toContain("OpenFreeMap");
    expect(html).toContain("OpenMapTiles");
    expect(html).toContain("https://www.openstreetmap.org/copyright");
  });

  it("is the first copy under the Key in More map controls", () => {
    const key = pubMapTsx.indexOf('<TabsContent value="key"');
    expect(key).toBeGreaterThan(-1);
    const keyBlock = pubMapTsx.slice(key, pubMapTsx.indexOf("</TabsContent>", key));
    expect(keyBlock.indexOf("<MapKey")).toBeGreaterThan(-1);
    expect(keyBlock.indexOf("<MapCredits")).toBeGreaterThan(keyBlock.indexOf("<MapKey"));
  });
});
