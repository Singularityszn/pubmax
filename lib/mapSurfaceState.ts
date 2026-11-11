import { shouldOpenPlanningInitially } from "@/lib/mapArrival";
import type { MapOverlay } from "@/lib/mobileShell";

/**
 * Which surface the map shows, and which open surfaces an action closes.
 *
 * A lane is a column that stays up beside the surfaces. From 1024px the venue
 * list beside the map is the split lane: a venue picked from it opens its
 * drawer next to the list, so no surface event ever changes the lane.
 */
type MapSurfaceLane = "split" | "none";

type MapSurfaceOverlay = Exclude<MapOverlay, "none" | "venue" | "planner" | "landmark">;

export type MapSurface =
  | { kind: "venue" }
  | { kind: "planner" }
  | { kind: "landmark" }
  | { kind: "overlay"; overlay: MapSurfaceOverlay }
  | { kind: "none" };

export type MapSurfaceState = { lane: MapSurfaceLane; surface: MapSurface };

export type MapSurfaceEvent =
  | { type: "open-venue" }
  | { type: "open-planner" }
  /** A chip, a sheet button or a close. Only the phone's one sheet makes it take the drawer's place. */
  | { type: "overlay"; overlay: MapOverlay; phone: boolean };

/**
 * An open surface the event closes.
 *
 * `planner-sheet` puts the planner's sheet back to half height. Opening a venue
 * does that, and an overlay on the phone does not, so Back to the planner after
 * a chip keeps the height the reader left it at.
 */
export type MapSurfaceRetirement = "venue" | "planner" | "planner-sheet" | "overlay";

export type MapSurfaceTransition = {
  state: MapSurfaceState;
  retire: readonly MapSurfaceRetirement[];
};

const NONE: MapSurface = { kind: "none" };

/** The surface a raw overlay value names. */
function surfaceForOverlay(overlay: MapOverlay): MapSurface {
  if (overlay === "none") return NONE;
  if (overlay === "venue" || overlay === "planner" || overlay === "landmark") return { kind: overlay };
  return { kind: "overlay", overlay };
}

/** The overlay value the phone shell reads for a surface. */
export function mapSurfaceOverlay(state: MapSurfaceState): MapOverlay {
  const { surface } = state;
  return surface.kind === "overlay" ? surface.overlay : surface.kind;
}

/**
 * The one surface each owner's open flag adds up to.
 *
 * The Drop picker, the venue sheet and the planner each own the surface outright
 * while they are up, so they answer ahead of whatever chip the reader last
 * opened. The landmark story answers under them: a venue pick retires the story
 * on screen, and the Back trail keeps it.
 */
export function mapSurfaceStateOf(owners: {
  splitList: boolean;
  logIntentFallbackVisible: boolean;
  detailOpen: boolean;
  planningOpen: boolean;
  storyOpen: boolean;
  mapOverlay: MapOverlay;
}): MapSurfaceState {
  const lane: MapSurfaceLane = owners.splitList ? "split" : "none";
  const overlay: MapOverlay = owners.logIntentFallbackVisible
    ? "moment"
    : owners.detailOpen
      ? "venue"
      : owners.planningOpen
        ? "planner"
        : owners.storyOpen
          ? "landmark"
          : owners.mapOverlay;
  return { lane, surface: surfaceForOverlay(overlay) };
}

/**
 * The one transition. The venue drawer and the planner share one drawer, so
 * each one opening closes the other and any overlay. An overlay closes them
 * only on the phone, where every surface shares one sheet. On a wider screen
 * the overlay sits apart from the drawer, which keeps its place.
 */
export function transition(state: MapSurfaceState, event: MapSurfaceEvent): MapSurfaceTransition {
  switch (event.type) {
    case "open-venue":
      return { state: { ...state, surface: { kind: "venue" } }, retire: ["planner", "planner-sheet", "overlay"] };
    case "open-planner":
      return { state: { ...state, surface: { kind: "planner" } }, retire: ["venue", "overlay"] };
    case "overlay":
      return overlayTransition(state, event.overlay, event.phone);
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

function overlayTransition(state: MapSurfaceState, overlay: MapOverlay, phone: boolean): MapSurfaceTransition {
  const next = surfaceForOverlay(overlay);
  if (phone && next.kind !== "none") return { state: { ...state, surface: next }, retire: ["venue", "planner"] };
  const drawerUp = state.surface.kind === "venue" || state.surface.kind === "planner" || state.surface.kind === "landmark";
  return { state: drawerUp ? state : { ...state, surface: next }, retire: [] };
}

export function mapSurfaceSearch(search: string, surfaceId: string): string {
  const params = new URLSearchParams(search);
  if (surfaceId !== "planner") {
    params.delete("plan");
    const query = `?${params}`;
    if (shouldOpenPlanningInitially(params.get("mode") === "build" ? "build" : "suggest", query)) {
      params.delete("mode");
      params.delete("style");
    }
  }
  return params.toString();
}
