/**
 * Whether the map's canvas can be shown at all, and what to say when it cannot.
 *
 * WHY THIS EXISTS. `components/PubMapCanvas.tsx` already diagnoses every way a
 * MOUNTED map can fail: a refused WebGL context, a zero-size container, a lost
 * context, a tile source that will not answer, a scene that never produced a
 * frame. Each of those has its own watchdog, its own honest heading and the
 * shared fallback card. None of them can fire when the canvas never mounts.
 *
 * MapLibre is about 327 KB and lives in its own chunk behind a dynamic import,
 * deliberately, so the map shell paints before it arrives. That chunk is a
 * network request like any other. Measured on a production build with the
 * chunk aborted, a reader got the whole-app error page: no venue list, no
 * selected pub's sheet, no Pint Drop composer, and a Try again that re-entered
 * the same rejected module. A blocked map library took the pubs with it.
 *
 * The other silence is a canvas that neither becomes ready nor errors. Every
 * watchdog inside the canvas is armed by the canvas itself, so a mount that
 * never gets that far has nothing watching it: the reader is left on a held
 * loading frame, or on an empty map slot the shell believes is fine, with no
 * sentence either way.
 *
 * MapLibre construction stops the shell's clock. The canvas then owns its
 * first-frame, scene-ready and pin-reveal watchdogs. Keeping the shell's clock
 * running would let it unmount a canvas before those watchdogs answer.
 *
 * So the SHELL owns two answers the canvas cannot give, and this module is the
 * whole of that policy: the reason vocabulary, the readiness ceiling, and every
 * word either state prints. It performs no I/O and touches no map, in the shape
 * of lib/mapTileFailure.ts and lib/mapDataPackFailure.ts, so the decision stays
 * testable without a renderer. `__tests__/mapCanvasAvailability.test.ts` pins
 * the policy, including the construction handoff.
 */

/**
 * Maximum shell wait before a canvas reports construction, readiness or failure.
 * Construction ends this wait even while the canvas is still preparing to draw.
 */
export const MAP_CANVAS_READINESS_CEILING_MS = 18_000;

/**
 * Why the shell is showing the map's own content without a map.
 *
 * `module` - the canvas module never loaded or threw on the way up, so nothing
 * of MapLibre is on the page. `timeout` - it mounted, said nothing, and the
 * ceiling lapsed.
 */
export type MapCanvasUnavailableReason = "module" | "timeout";

export type MapCanvasReadinessState = {
  /** The canvas module failed to load, or its subtree threw while mounting. */
  readonly moduleFailed: boolean;
  /**
   * The canvas has committed to its OWN fallback card. It owns the surface in
   * that case and the shell says nothing over the top of it.
   */
  readonly canvasOwnsFailure: boolean;
  /**
   * The canvas has published a ready map. This is the ONE positive signal a
   * live canvas gives, and it is deliberately not the loading frame's own
   * question: that frame lifts on painted pins, which the shell can satisfy
   * from the slim index while no canvas exists at all. Arming the ceiling on
   * the frame instead left a blocked chunk showing an empty map slot for ever
   * with no loading chrome to explain it.
   */
  readonly canvasReady: boolean;
  /** The readiness ceiling has lapsed since this attempt began. */
  readonly ceilingLapsed: boolean;
};

export type MapCanvasAvailability =
  | { readonly status: "ready" }
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly reason: MapCanvasUnavailableReason };

/**
 * What the shell should show where the map goes.
 *
 * Order is the point. A module that never loaded is the strongest fact there
 * is, so it answers first and nothing later talks over it. A canvas already
 * showing its own card keeps the surface, because it diagnosed WHY and a
 * vaguer shell notice on top of it would blame the wrong thing. A canvas that
 * published ready is ready even if the ceiling lapsed on the way, because a
 * map that arrived late is still a map. Only then does a lapsed ceiling
 * become an answer.
 */
export function mapCanvasAvailability(
  state: MapCanvasReadinessState,
): MapCanvasAvailability {
  if (state.moduleFailed) return { status: "unavailable", reason: "module" };
  if (state.canvasOwnsFailure) return { status: "ready" };
  if (state.canvasReady) return { status: "ready" };
  if (state.ceilingLapsed) return { status: "unavailable", reason: "timeout" };
  return { status: "loading" };
}

/**
 * Whether the shell's held loading frame must let go. It lets go for either
 * unavailable answer, so the honest card is never painted behind the chrome
 * that was waiting for it.
 */
export function mapCanvasFrameReleased(availability: MapCanvasAvailability): boolean {
  return availability.status === "unavailable";
}

/**
 * Whether the readiness ceiling should be running. It runs from mount until
 * the canvas answers one way or the other, or starts watching itself: a module
 * failure already has its answer, a canvas showing its own card has given one,
 * a ready canvas is the answer, and a canvas that has built its map owns every
 * answer after that. Nothing else stops the clock.
 */
export function mapCanvasCeilingArmed(
  state: Omit<MapCanvasReadinessState, "ceilingLapsed"> & {
    /** The canvas has built MapLibre and armed its own watchdogs. */
    readonly canvasWatching: boolean;
  },
): boolean {
  return (
    !state.canvasReady &&
    !state.moduleFailed &&
    !state.canvasOwnsFailure &&
    !state.canvasWatching
  );
}

/**
 * A stable name for the canvas slot's state, stamped on the slot itself so a
 * browser test can read what the shell decided rather than inferring it from
 * whichever card happens to be painted.
 */
export function mapCanvasSlotState(availability: MapCanvasAvailability): string {
  return availability.status === "unavailable"
    ? `unavailable-${availability.reason}`
    : availability.status;
}

/** Heading over the map's own content when there is no map to put it on. */
export function mapCanvasUnavailableHeading(
  reason: MapCanvasUnavailableReason,
): string {
  return reason === "module" ? "Map couldn't load" : "Map didn't finish loading";
}

/**
 * The plain sentence under that heading. It states what happened and what the
 * reader still has, and it claims nothing about their browser or their signal,
 * because neither case knows which one it was.
 */
export function mapCanvasUnavailableLine(reason: MapCanvasUnavailableReason): string {
  return reason === "module"
    ? "The map's own code never arrived. The pub list and crawl planner beside it still work as ever."
    : "The map is taking longer than it should. The pub list and crawl planner beside it still work as ever.";
}

/** The one control on that card. Same word the canvas's own card uses. */
export const MAP_CANVAS_RETRY_LABEL = "Retry";
