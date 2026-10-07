// @vitest-environment jsdom

import { AttributionControl } from "maplibre-gl";
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

describe("the emitted map attribution", () => {
  it.each([320, 390, 430, 641, 1440])(
    "keeps the pub credit through disclosure and style changes at %ipx",
    (width) => {
      const canvas = document.createElement("div");
      Object.defineProperty(canvas, "offsetWidth", { value: width });
      const listeners = new Map<string, (event: { dataType: string }) => void>();
      const map = {
        style: { stylesheet: {}, tileManagers: {} },
        getCanvasContainer: () => canvas,
        _getUIString: () => "Toggle attribution",
        on: (event: string, listener: (event: { dataType: string }) => void) => listeners.set(event, listener),
        off: (event: string) => listeners.delete(event),
      };
      const control = new AttributionControl({
        compact: true,
        customAttribution: OSM_ATTRIBUTION,
      });
      const element = control.onAdd(map as unknown as Parameters<AttributionControl["onAdd"]>[0]);
      document.body.append(element);
      try {
        const button = element.querySelector<HTMLElement>("summary")!;
        const credit = element.querySelector(".maplibregl-ctrl-attrib-inner")!;
        expect(element.querySelectorAll("summary")).toHaveLength(1);
        expect(button.getAttribute("aria-label")).toBe("Toggle attribution");
        for (const expanded of [true, false, true]) {
          expect(element.classList.contains("maplibregl-compact-show")).toBe(expanded);
          expect(credit.textContent).toBe("Pub data © OpenStreetMap contributors (ODbL)");
          button.click();
        }
        map.style = { stylesheet: {}, tileManagers: {} };
        listeners.get("styledata")!({ dataType: "style" });
        button.click();
        expect(element.classList.contains("maplibregl-compact-show")).toBe(true);
        expect(credit.textContent).toBe("Pub data © OpenStreetMap contributors (ODbL)");
      } finally {
        control.onRemove();
      }
      expect(element.isConnected).toBe(false);
      expect(listeners.size).toBe(0);
    },
  );
});

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
