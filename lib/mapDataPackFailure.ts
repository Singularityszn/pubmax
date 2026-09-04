/**
 * App data pack recovery - the failure lane that is NOT about the basemap.
 *
 * WHY THIS EXISTS. `map.on("error")` in PubMapCanvas hears two very different
 * things through one channel. Most of them are basemap tiles, and
 * lib/mapTileFailure.ts is their whole policy: count a burst, spend ONE style
 * reload, then surface the honest card. But one source in the scene is a file
 * of OURS served from `/data` - the transit lines - and MapLibre fetches it
 * itself, so an HTTP failure on it arrives in the same handler and used to be
 * pushed into the same sliding burst window.
 *
 * That is wrong in both directions. It makes a fact about one JSON file count
 * toward a verdict about the tile source, and the remedy it buys - `setStyle`,
 * which tears down and rebuilds every source and every layer - cannot fix a
 * file the server is refusing. Worse, the reload re-requests that same file, so
 * a single 500 could spend the mount's one shared recovery and then surface a
 * basemap failure card over a map whose basemap was never the problem. That is
 * the shape #1425 found from the other end: an 82 KB `/data` pack answering 500
 * because a Node proxy ran in front of a healthy static file.
 *
 * So a pack failure gets its own bounded lane, and it is deliberately small:
 * ONE retry of that pack alone, then the pack is degraded to empty and the map
 * carries on without it. Never a style reload, never the basemap error card,
 * and never a stamp in the tile-failure window - the burst threshold there
 * stays exactly as it was, for the genuine tile failures it was written for.
 *
 * This module is the decision only. It performs no I/O and touches no map, in
 * the same shape as lib/mapTileFailure.ts, so the policy stays testable without
 * a renderer. `__tests__/mapDataPackFailure.test.ts` pins it.
 */

/**
 * The scene sources whose bytes are one of our own public packs rather than a
 * basemap tile source. `buildTransitLines` is the only one that hands MapLibre
 * a URL; every other geojson source in components/map/canvas/buildScene.ts is
 * given an in-memory FeatureCollection the app already fetched itself, so it
 * can never raise a fetch error here. Add a source id to this list ONLY when
 * MapLibre owns its fetch.
 */
export const APP_DATA_PACK_SOURCE_IDS = ["tube-lines"] as const;

export type AppDataPackSourceId = (typeof APP_DATA_PACK_SOURCE_IDS)[number];

/**
 * How long to wait before the one retry. Long enough that a redeploy's
 * in-flight edge purge or a momentary blip has passed, short enough that the
 * lines appear within the same look at the map.
 */
export const DATA_PACK_RETRY_DELAY_MS = 1_500;

/** The pack this error is about, or null when it is not a pack at all. */
export function appDataPackSourceId(sourceId: unknown): AppDataPackSourceId | null {
  return typeof sourceId === "string" &&
    (APP_DATA_PACK_SOURCE_IDS as readonly string[]).includes(sourceId)
    ? (sourceId as AppDataPackSourceId)
    : null;
}

export type DataPackSpendState = {
  readonly retried: readonly AppDataPackSourceId[];
  readonly degraded: readonly AppDataPackSourceId[];
};

export const INITIAL_DATA_PACK_SPEND: DataPackSpendState = {
  retried: [],
  degraded: [],
};

/** Refetch this pack once, empty it, or do nothing further. */
export type DataPackRecoveryEffect = "retry" | "degrade" | "none";

/**
 * Spend one failure of one pack. The budget is PER PACK and per mount: the
 * first failure earns the single retry, the second degrades that pack, and
 * anything after that is silence rather than a loop. A pack's outcome never
 * touches another pack's budget, and none of it reaches the tile-failure
 * window.
 */
export function spendDataPackFailure(
  state: DataPackSpendState,
  sourceId: AppDataPackSourceId,
): { state: DataPackSpendState; effect: DataPackRecoveryEffect } {
  if (state.degraded.includes(sourceId)) return { state, effect: "none" };
  if (state.retried.includes(sourceId)) {
    return {
      state: { ...state, degraded: [...state.degraded, sourceId] },
      effect: "degrade",
    };
  }
  return {
    state: { ...state, retried: [...state.retried, sourceId] },
    effect: "retry",
  };
}

/** Whether this pack has already been given up on, so a retry is pointless. */
export function dataPackDegraded(
  state: DataPackSpendState,
  sourceId: AppDataPackSourceId,
): boolean {
  return state.degraded.includes(sourceId);
}
