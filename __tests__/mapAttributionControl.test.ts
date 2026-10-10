// @vitest-environment jsdom

import { AttributionControl } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { OSM_ATTRIBUTION } from "@/components/map/canvas/tokens";

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
