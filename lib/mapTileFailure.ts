/**
 * Tile-failure classifier - pure decision for the second black-canvas class.
 *
 * Background: the paint watchdog (lib/mapPaintWatchdog.ts, #548) catches a
 * PARKED renderer - no frames presenting. It is structurally blind to the
 * opposite failure: the frame loop runs at full rate while the tiles behind it
 * failed to load (network drop, tile CDN outage, sprite/glyph fetch failure),
 * so the canvas presents a healthy stream of black/empty frames. Post-#548 the
 * only remaining silent-black class is this one.
 *
 * This module is ONLY the decision. Given the recent post-style-load error
 * history, whether a critical resource (sprite/glyph or initial basemap
 * metadata) failed, tab visibility, and the shared recovery budget, it
 * answers: ignore the noise, spend ONE bounded retry (a full style reload),
 * or surface the honest error card.
 * It performs no I/O and touches no map - the caller owns side effects,
 * counters, and the error card, so this stays hermetically testable.
 *
 * Classification rules:
 * - A lone tile miss is routine (a pan across a flaky cell) and is ignored.
 * - Tile errors observed while hidden or while the camera is in flight are
 *   ignored: aborts and catch-up misses are expected there. A terminal
 *   map-wide resource error bypasses those guards because it emits once and
 *   MapLibre then marks the failed resource loaded.
 * - Before the initial basemap has painted, a burst is systemic immediately.
 *   Initial viewport requests are concurrent, so a complete outage reports
 *   every failure quickly and may never emit another error.
 * - After a real basemap paint, a burst is systemic only if it is SUSTAINED:
 *   first-to-last error span of at least TILE_FAILURE_SUSTAIN_MS. A sub-5s
 *   self-healing blip never spans it.
 * - A critical sprite/glyph failure breaks labels/icons map-wide. An initial
 *   vector/raster source metadata failure leaves no tiles to request, so it
 *   emits only once. Both count as systemic without a sustain requirement.
 * - The first systemic verdict earns one retry IF the shared recovery budget
 *   (paint watchdog cap) still has room.
 * - After that single retry, a fresh systemic verdict surfaces the error
 *   card. Never a second retry loop, never a silent black canvas.
 */

/** Sliding window for counting tile errors toward a burst (ms). */
export const TILE_FAILURE_WINDOW_MS = 10_000;
/**
 * Tile errors inside the window that count as a systemic failure. A healthy
 * viewport pan touches dozens of tiles; four failures in ten seconds is not a
 * flaky cell, it is a failing source.
 */
export const TILE_FAILURE_BURST = 4;
/**
 * A burst must also persist this long (first to last error) before it counts
 * as systemic. Transient flight/tile-catch-up black frames self-heal faster
 * than this; a real source outage errors continuously and crosses it.
 */
export const TILE_FAILURE_SUSTAIN_MS = 5_000;

export type TileFailureDecision = "ignore" | "retry" | "surface";

export type CriticalBasemapFailureInput = {
  message: string;
  initialBasemapPending: boolean;
  sourceType?: unknown;
  tilePresent: boolean;
};

/**
 * MapLibre emits one source-level error when TileJSON metadata fails, then
 * marks that source loaded so it will be ignored. Do not make that terminal
 * error satisfy a tile-burst threshold it can never reach.
 */
export function isCriticalBasemapFailure({
  message,
  initialBasemapPending,
  sourceType,
  tilePresent,
}: CriticalBasemapFailureInput): boolean {
  if (/sprite|glyph/i.test(message)) return true;
  return (
    initialBasemapPending &&
    !tilePresent &&
    (sourceType === "vector" ||
      sourceType === "raster" ||
      sourceType === "raster-dem")
  );
}

export type TileFailureInput = {
  /** Monotonic clock reading for this sample (e.g. performance.now()). */
  now: number;
  /**
   * Timestamps of post-style-load map error events, already pruned or not -
   * the classifier only counts the ones inside the window.
   */
  errorTimestamps: readonly number[];
  /** A map-wide resource failed and counts as a burst on its own. */
  criticalFailure: boolean;
  /** document.visibilityState === "visible". Hidden tabs fail fetches benignly. */
  documentVisible: boolean;
  /**
   * The camera is mid-flight (map.isMoving()). Tile misses during a flight
   * are expected catch-up, not failure; never act on them.
   */
  cameraInFlight: boolean;
  /** The one bounded tile retry has already been spent this mount. */
  retrySpent: boolean;
  /**
   * Remaining shared recovery budget (paint watchdog cap minus recoveries
   * already spent by EITHER net). At zero, retries are over for the mount.
   */
  recoveryBudgetLeft: number;
  /**
   * No real basemap tile frame has painted for the current style generation.
   * Initial tile requests fail concurrently, so burst count alone is enough.
   */
  initialBasemapPending?: boolean;
  /** Override for tests; defaults to TILE_FAILURE_BURST. */
  burstThreshold?: number;
  /** Override for tests; defaults to TILE_FAILURE_WINDOW_MS. */
  windowMs?: number;
  /** Override for tests; defaults to TILE_FAILURE_SUSTAIN_MS. */
  sustainMs?: number;
};

/** Drop error stamps that have aged out of the sliding window. */
export function pruneTileFailures(
  timestamps: readonly number[],
  now: number,
  windowMs: number = TILE_FAILURE_WINDOW_MS,
): number[] {
  return timestamps.filter((t) => now - t <= windowMs);
}

/**
 * Classify the current post-style-load error state. See module doc for the
 * rules; the caller acts on the verdict exactly once per sample.
 */
export function classifyTileFailure(input: TileFailureInput): TileFailureDecision {
  const {
    now,
    errorTimestamps,
    criticalFailure,
    documentVisible,
    cameraInFlight,
    retrySpent,
    recoveryBudgetLeft,
    initialBasemapPending = false,
    burstThreshold = TILE_FAILURE_BURST,
    windowMs = TILE_FAILURE_WINDOW_MS,
    sustainMs = TILE_FAILURE_SUSTAIN_MS,
  } = input;

  // A terminal source/style resource emits one error, then MapLibre marks it
  // loaded. Act now even if the tab is hidden or the camera is moving because
  // there may be no post-flight or foreground event to replay.
  if (criticalFailure) {
    if (!retrySpent && recoveryBudgetLeft > 0) return "retry";
    return "surface";
  }

  // A hidden tab aborts ordinary tile fetches as a matter of course.
  if (!documentVisible) return "ignore";
  // Mid-flight misses are the tile stream catching up to the camera, not a
  // failure. Stamps keep accumulating in the caller, so a genuine outage
  // escalates on the first post-flight error.
  if (cameraInFlight) return "ignore";

  const recent = pruneTileFailures(errorTimestamps, now, windowMs);
  const span =
    recent.length > 1 ? Math.max(...recent) - Math.min(...recent) : 0;
  const sustainedBurst = recent.length >= burstThreshold && span >= sustainMs;
  const initialBurst = initialBasemapPending && recent.length >= burstThreshold;
  const systemic = initialBurst || sustainedBurst;
  if (!systemic) return "ignore";

  if (!retrySpent && recoveryBudgetLeft > 0) return "retry";
  return "surface";
}
