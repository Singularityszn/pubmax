// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useMapPlanPresentation } from "@/components/map/pubmap/useMapPlanCoordinator";
import { useActivePlanPalNextStop } from "@/components/map/pubmap/useActivePlanRoute";
import { clearActivePlan, writeActivePlan } from "@/lib/activePlan";
import type { PlanStopDTO } from "@/lib/plan";
import type { Venue } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The map Pal waits at tonight's next stop only while tonight's plan owns the
// route on the map. Ownership is the presentation's own answer, so a crawl the
// reader builds and maps owns the map even when its pubs are tonight's pubs.

const pub = (id: string, longitude: number): Venue =>
  ({ id, name: `The ${id}`, latitude: 51.51, longitude, category: "pub" }) as unknown as Venue;
const lamb = pub("Lamb", -0.12);
const crown = pub("Crown", -0.13);
const bell = pub("Bell", -0.14);
const venueById = new Map([lamb, crown, bell].map((venue) => [venue.id, venue]));
const stops: PlanStopDTO[] = [lamb, crown, bell].map((venue, position) => ({
  venueId: venue.id,
  venueName: venue.name,
  position,
}));
const tonight = [lamb, crown, bell];

type Seen = ReturnType<typeof useActivePlanPalNextStop>;

function Probe({ builtIds, routeMapped, seen }: { builtIds: string[]; routeMapped: boolean; seen: Seen[] }) {
  const { routeMappedActive } = useMapPlanPresentation({
    mode: "build",
    builtIds,
    routeMapped,
    suggestedRoute: [],
    activePlanRoute: tonight,
    venueById,
  });
  seen.push(useActivePlanPalNextStop(stops, tonight, routeMappedActive, venueById));
  return null;
}

describe("the map Pal's next stop", () => {
  let root: Root | null = null;

  beforeEach(() => {
    writeActivePlan({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      stopIndex: 0,
    });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    clearActivePlan();
  });

  async function render(builtIds: string[], routeMapped: boolean): Promise<Seen> {
    const seen: Seen[] = [];
    const host = document.createElement("div");
    root = createRoot(host);
    await act(async () => root!.render(createElement(Probe, { builtIds, routeMapped, seen })));
    return seen.at(-1)!;
  }

  it("waits at the stop after the cursor when tonight's plan owns the map", async () => {
    expect(await render([], false)).toEqual({
      routeIsActivePlan: true,
      palNextStop: { venueId: "Crown", name: "The Crown" },
    });
  });

  it("does not wait on a mapped crawl the reader built, even with tonight's pubs in tonight's order", async () => {
    expect(await render(["Lamb", "Crown", "Bell"], true)).toEqual({ routeIsActivePlan: false, palNextStop: null });
  });

  it("goes back to tonight's plan when the built crawl is only drafted, not mapped", async () => {
    expect((await render(["Lamb", "Crown", "Bell"], false)).routeIsActivePlan).toBe(true);
  });
});
