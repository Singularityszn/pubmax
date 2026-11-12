// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import BeenHerePostcodesToggle from "@/components/map/beenHere/BeenHerePostcodesToggle";
import type { SlimVenue, SlimVenueLoadResult } from "@/lib/venuesSlim";

const state = vi.hoisted(() => ({ on: true, visited: new Set(["visited"]), load: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCityResult: state.load }));
vi.mock("@/components/map/beenHere/useBeenHere", () => ({
  useBeenHerePostcodesOn: () => state.on,
  useBeenHereVenueIds: () => state.visited,
  setBeenHerePostcodesOn: (on: boolean) => { state.on = on; },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows no figures for unavailable or empty loads and recovers when toggled", async () => {
  const pub: SlimVenue = {
    id: "visited", name: "Visited pub", kind: "pub", lat: 51.5, lng: -0.1,
    cheapestPrice: null, borough: "Southwark", filterHints: {
      searchText: "se1 9dd", canonical: true,
      amenities: { food: false, cocktails: false, beerGarden: false, nonAlcoholic: false },
      curation: { nearWater: false, hasStory: false },
    },
  };
  const failures: SlimVenueLoadResult[] = [
    { status: "unavailable", rows: [pub] },
    { status: "unavailable", rows: [] },
    { status: "ready", rows: [] },
    { status: "ready", rows: [{ ...pub, retired: true }] },
  ];
  for (const result of failures) state.load.mockResolvedValueOnce(result);
  state.load.mockRejectedValueOnce(new Error("offline"));
  state.load.mockResolvedValueOnce({ status: "ready", rows: [pub] });
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = async (on: boolean) => {
    state.on = on;
    await act(async () => { root.render(<BeenHerePostcodesToggle />); });
  };
  try {
    for (let attempt = 0; attempt < failures.length + 1; attempt += 1) {
      await render(true);
      expect(host.querySelector(".mapLayersHint")).toBeNull();
      await render(false);
    }
    await render(true);
    expect(host.textContent).toContain("SE1 1 of 1, 100%");
    expect(state.load).toHaveBeenCalledTimes(6);
    await render(false);
    await render(true);
    expect(host.textContent).toContain("SE1 1 of 1, 100%");
    expect(state.load).toHaveBeenCalledTimes(6);
  } finally {
    await act(async () => { root.unmount(); });
  }
});
