import { describe, expect, it } from "vitest";

import type { MapOverlay } from "@/lib/mobileShell";
import {
  mapSurfaceOverlay,
  mapSurfaceStateOf,
  transition,
  type MapSurface,
  type MapSurfaceState,
} from "@/lib/mapSurfaceState";

const owners = {
  splitList: false,
  logIntentFallbackVisible: false,
  detailOpen: false,
  planningOpen: false,
  storyOpen: false,
  mapOverlay: "layers" as MapOverlay,
};

const overlayOf = (input: Partial<typeof owners>) =>
  mapSurfaceOverlay(mapSurfaceStateOf({ ...owners, ...input }));

const at = (surface: MapSurface, lane: MapSurfaceState["lane"] = "none"): MapSurfaceState => ({ lane, surface });

const SURFACES: MapSurface[] = [
  { kind: "none" },
  { kind: "venue" },
  { kind: "planner" },
  { kind: "landmark" },
  { kind: "overlay", overlay: "layers" },
];

describe("mapSurfaceStateOf", () => {
  it("lets a surface that owns the screen answer ahead of the last-opened chip", () => {
    expect(overlayOf({})).toBe("layers");
    expect(overlayOf({ planningOpen: true })).toBe("planner");
    expect(overlayOf({ planningOpen: true, detailOpen: true })).toBe("venue");
    expect(overlayOf({ detailOpen: true, logIntentFallbackVisible: true })).toBe("moment");
    expect(overlayOf({ mapOverlay: "none" })).toBe("none");
  });

  it("lets the landmark story own the screen under the venue and the planner", () => {
    expect(overlayOf({ storyOpen: true })).toBe("landmark");
    expect(overlayOf({ storyOpen: true, detailOpen: true })).toBe("venue");
    expect(overlayOf({ storyOpen: true, planningOpen: true })).toBe("planner");
  });

  it("keeps the split list as a lane beside the venue drawer", () => {
    expect(mapSurfaceStateOf({ ...owners, splitList: true, detailOpen: true })).toEqual({
      lane: "split",
      surface: { kind: "venue" },
    });
  });
});

describe("transition", () => {
  it("opens a venue over any surface and closes the planner, its sheet and any overlay", () => {
    for (const surface of SURFACES) {
      expect(transition(at(surface), { type: "open-venue" })).toEqual({
        state: at({ kind: "venue" }),
        retire: ["planner", "planner-sheet", "overlay"],
      });
    }
  });

  it("opens the planner over any surface and closes the venue and any overlay", () => {
    for (const surface of SURFACES) {
      expect(transition(at(surface), { type: "open-planner" })).toEqual({
        state: at({ kind: "planner" }),
        retire: ["venue", "overlay"],
      });
    }
  });

  it("gives the phone's one sheet to an overlay and closes the venue and the planner", () => {
    for (const surface of SURFACES) {
      expect(transition(at(surface), { type: "overlay", overlay: "tonight", phone: true })).toEqual({
        state: at({ kind: "overlay", overlay: "tonight" }),
        retire: ["venue", "planner"],
      });
    }
  });

  it("closes only the overlay when the phone's overlay closes", () => {
    expect(transition(at({ kind: "overlay", overlay: "layers" }), { type: "overlay", overlay: "none", phone: true })).toEqual({
      state: at({ kind: "none" }),
      retire: [],
    });
    expect(transition(at({ kind: "venue" }), { type: "overlay", overlay: "none", phone: true })).toEqual({
      state: at({ kind: "venue" }),
      retire: [],
    });
  });

  it("keeps the drawer in place when an overlay opens on a wider screen", () => {
    for (const kind of ["venue", "planner", "landmark"] as const) {
      expect(transition(at({ kind }), { type: "overlay", overlay: "search", phone: false })).toEqual({
        state: at({ kind }),
        retire: [],
      });
    }
    expect(transition(at({ kind: "none" }), { type: "overlay", overlay: "choose-area", phone: false })).toEqual({
      state: at({ kind: "overlay", overlay: "choose-area" }),
      retire: [],
    });
    expect(transition(at({ kind: "overlay", overlay: "search" }), { type: "overlay", overlay: "none", phone: false })).toEqual({
      state: at({ kind: "none" }),
      retire: [],
    });
  });

  it("at 1440, a venue picked from the split list opens beside the list", () => {
    const listUp = mapSurfaceStateOf({ ...owners, splitList: true, mapOverlay: "none" });
    expect(transition(listUp, { type: "open-venue" }).state).toEqual({ lane: "split", surface: { kind: "venue" } });
  });

  it("never changes the lane", () => {
    const events = [
      { type: "open-venue" },
      { type: "open-planner" },
      { type: "overlay", overlay: "layers", phone: true },
      { type: "overlay", overlay: "none", phone: false },
    ] as const;
    for (const surface of SURFACES) {
      for (const event of events) {
        expect(transition(at(surface, "split"), event).state.lane).toBe("split");
      }
    }
  });
});
