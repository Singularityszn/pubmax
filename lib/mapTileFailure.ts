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
 * history, whether a critical resource (sprite/glyph) failed, tab visibility,
 * and the shared recovery budget, it answers: ignore the noise, spend ONE
 * bounded retry (a full style reload), or surface the honest error card.
 * It performs no I/O and touches no map - the caller owns side effects,
 * counters, and the error card, so this stays hermetically testable.
 *
 * Classification rules:
 * - A lone tile miss is routine (a pan across a flaky cell) and is ignored.
 * - Anything observed while the camera is in flight is ignored outright:
 *   a fast flyTo legitimately outruns the tile stream and paints black for a
 *   few seconds before tiles catch up (watched live on prod, self-healed in
 *   under 5s). Stamps still accumulate, so a real outage escalates as soon as
 *   the flight ends and errors continue.
 * - A burst (>= TILE_FAILURE_BURST errors inside TILE_FAILURE_WINDOW_MS) is
 *   systemic only if it is also SUSTAINED: first-to-last error span of at
 *   least TILE_FAILURE_SUSTAIN_MS. A sub-5s self-healing blip never spans it;
 *   a failing source keeps erroring and crosses it quickly.
 * - A critical sprite/glyph failure breaks labels/icons map-wide and counts
 *   as systemic on its own (no sustain requirement).
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

export type TileFailureInput = {
  /** Monotonic clock reading for this sample (e.g. performance.now()). */
  now: number;
  /**
   * Timestamps of post-style-load map error events, already pruned or not -
   * the classifier only counts the ones inside the window.
   */
  errorTimestamps: readonly number[];
  /**
   * A style-level resource (sprite sheet, glyph range) failed. One of these
   * breaks labels/icons across the whole map, so it counts as a burst on its
   * own.
   */
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
    burstThreshold = TILE_FAILURE_BURST,
    windowMs = TILE_FAILURE_WINDOW_MS,
    sustainMs = TILE_FAILURE_SUSTAIN_MS,
  } = input;

  // A hidden tab aborts fetches as a matter of course; nothing is wrong.
  if (!documentVisible) return "ignore";
  // Mid-flight misses are the tile stream catching up to the camera, not a
  // failure. Stamps keep accumulating in the caller, so a genuine outage
  // escalates on the first post-flight error.
  if (cameraInFlight) return "ignore";

  const recent = pruneTileFailures(errorTimestamps, now, windowMs);
  const span =
    recent.length > 1 ? Math.max(...recent) - Math.min(...recent) : 0;
  const sustainedBurst = recent.length >= burstThreshold && span >= sustainMs;
  const systemic = criticalFailure || sustainedBurst;
  if (!systemic) return "ignore";

  if (!retrySpent && recoveryBudgetLeft > 0) return "retry";
  return "surface";
}
