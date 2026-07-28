import { describe, expect, it, vi } from "vitest";

import {
  PUB_FIRST_LAYERS,
  wireClickRouting,
} from "@/components/map/canvas/interactions";
import type { Landmark } from "@/lib/landmarks";

describe("landmark interactions", () => {
  it("opens the landmark inspector from a label that survived icon collision", () => {
    const bigBen: Landmark = {
      id: "big-ben",
      name: "Big Ben",
      coordinates: [-0.1246, 51.5007],
      history: "History",
      icon: "clock-tower",
      source: { label: "UK Parliament", url: "https://example.com" },
    };
    let clickHandler: ((event: { point: { x: number; y: number } }) => void) | undefined;
    const map = {
      on: vi.fn((event: string, handler: typeof clickHandler) => {
        if (event === "click") clickHandler = handler;
      }),
      getLayer: vi.fn(() => ({})),
      queryRenderedFeatures: vi.fn(() => [{
        layer: { id: "landmarks-label" },
        properties: { id: "big-ben" },
      }]),
      getZoom: vi.fn(() => 11.5),
    };
    const selectLandmark = vi.fn();
    const cinematic = vi.fn();

    wireClickRouting(map as never, {
      selectLandmark,
      setHoveredVenue: vi.fn(),
      setActivePoi: vi.fn(),
      onVenueClickRef: { current: vi.fn() },
      onUkBasePubClickRef: { current: vi.fn() },
      onRouteStopClickRef: { current: vi.fn() },
      onTonightOpportunityClickRef: { current: vi.fn() },
      cityLandmarksRef: { current: [bigBen] },
      tonightOpportunitiesRef: { current: [] },
      cinematic,
    });

    clickHandler?.({ point: { x: 100, y: 200 } });

    expect(PUB_FIRST_LAYERS.indexOf("landmarks-label")).toBeGreaterThan(
      PUB_FIRST_LAYERS.indexOf("clusters"),
    );
    expect(selectLandmark).toHaveBeenCalledWith(bigBen);
    expect(cinematic).toHaveBeenCalledWith(
      expect.objectContaining({ center: bigBen.coordinates, zoom: 13 }),
      "landmark",
    );
  });
});
