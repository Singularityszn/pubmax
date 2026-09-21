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
 * - After a real basemap paint, a burst is systemic only if it remains
 *   unrecovered for TILE_FAILURE_SUSTAIN_MS. A sub-5s self-healing blip never
 *   reaches that boundary.
 * - A critical sprite/glyph failure breaks labels/icons map-wide. An initial
 *   vector/raster source metadata failure leaves no tiles to request, so it
 *   emits only once. Both count as systemic without a sustain requirement.
 * - A verdict that a SOURCE could answer spends the silent lane first:
 *   MapLibre never re-asks for a tile it failed, so a hole left by a transient
 *   outage stays until the camera moves. `retry-source` re-asks the basemap
 *   SOURCE for its own tiles, with backoff, and is invisible: no style reload,
 *   no notice, no console line. A sprite or glyph is a STYLE resource and no
 *   source reload can re-fetch it, so it skips the silent lane.
 * - Only once the silent lane is spent does the first systemic verdict earn
 *   one style reload, IF the shared recovery budget (paint watchdog cap) still
 *   has room.
 * - After that single retry, a fresh systemic verdict on the SAME source URL
 *   and viewport tile surfaces the error card. A new source URL or a camera
 *   move onto new tiles is a new cycle and is owed the ladder again. Never a
 *   second retry loop on one cycle, never a silent black canvas.
 * - Tile recovery may cancel the scene hang guard so a legitimate retry is
 *   not blamed as a stuck box. Cancelling without re-arming leaves a stalled
 *   recovery with no hang notice; re-arm once a reload-source or reload-style
 *   attempt begins, while the scene is still pending.
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
 * A burst must remain unrecovered this long before it counts as systemic.
 * Transient flight/tile-catch-up black frames self-heal faster than this.
 */
export const TILE_FAILURE_SUSTAIN_MS = 5_000;

/**
 * Silent source reloads before the mount's one style reload is considered.
 * Two, because a transient outage that survives two backed-off attempts is no
 * longer transient and the reader is owed the honest lane instead.
 */
export const TILE_SILENT_RETRY_MAX = 2;
/** The first silent retry waits this long; each later one doubles. */
export const TILE_SILENT_RETRY_BASE_DELAY_MS = 700;
/** Ceiling on that backoff, so a long-lived map never waits minutes. */
export const TILE_SILENT_RETRY_MAX_DELAY_MS = 4_000;

export type TileFailureDecision =
  | "ignore"
  /** Re-ask the basemap SOURCE for its tiles. Invisible to the reader. */
  | "retry-source"
  | "retry"
  | "surface";

export type BasemapTileReference = {
  sourceId?: unknown;
  sourceType?: unknown;
  tileKey?: unknown;
};

type BasemapTileReadinessMap = {
  getStyle: () =>
    | { sources?: Record<string, { type?: unknown }> }
    | null
    | undefined;
  areTilesLoaded: () => boolean;
  isSourceLoaded: (id: string) => boolean;
};

/**
 * Whether every tiled basemap source has settled for the current style.
 *
 * MapLibre briefly returns no style while `setStyle` swaps themes. That frame
 * is pending, not exceptional, and must never escape as a console crash.
 */
export function areBasemapTilesLoaded(map: BasemapTileReadinessMap): boolean {
  const sources = map.getStyle()?.sources;
  if (!sources) return false;
  const sourceIds = Object.entries(sources)
    .filter(([, source]) => (
      source.type === "vector" ||
      source.type === "raster" ||
      source.type === "raster-dem"
    ))
    .map(([id]) => id);
  if (sourceIds.length === 0 || !map.areTilesLoaded()) return false;
  try {
    return sourceIds.every((id) => map.isSourceLoaded(id));
  } catch {
    return false;
  }
}

function basemapTileReferenceKey({
  sourceId,
  sourceType,
  tileKey,
}: BasemapTileReference): string | null {
  if (
    sourceType !== "vector" &&
    sourceType !== "raster" &&
    sourceType !== "raster-dem"
  ) {
    return null;
  }
  if (typeof sourceId !== "string" || typeof tileKey !== "string") return null;
  return `${sourceId}:${tileKey}`;
}

export function createBasemapTileFailureTracker() {
  const failed = new Set<string>();
  return {
    reset() {
      failed.clear();
    },
    recordFailure(reference: BasemapTileReference) {
      const key = basemapTileReferenceKey(reference);
      if (key) failed.add(key);
    },
    recordSuccess(reference: BasemapTileReference): boolean {
      const key = basemapTileReferenceKey(reference);
      if (!key || !failed.delete(key)) return false;
      return failed.size === 0;
    },
    hasFailures() {
      return failed.size > 0;
    },
    /** Basemap tiles that failed and have not since loaded. */
    count() {
      return failed.size;
    },
  };
}

/**
 * A sprite or glyph belongs to the STYLE, not to a tile source: re-asking a
 * source for its tiles cannot re-fetch one, so this failure skips the silent
 * lane and goes straight to the style reload that could actually fix it.
 */
export function isStyleResourceFailure(message: string): boolean {
  return /sprite|glyph/i.test(message);
}

export type BasemapSourceReload =
  | { kind: "tiles"; tiles: string[] }
  | { kind: "url"; url: string };

/**
 * How to re-ask ONE style source for its own tiles, read off the serialized
 * source spec (`map.getStyle().sources[id]`) rather than the live source
 * object, so nothing here touches a private MapLibre field. A source with
 * neither an explicit tile list nor a TileJSON url, and every source that is
 * not tiled (a GeoJSON pin source above all), answers null and is left alone.
 */
export function basemapSourceReloadPlan(source: unknown): BasemapSourceReload | null {
  if (!source || typeof source !== "object") return null;
  const spec = source as { type?: unknown; tiles?: unknown; url?: unknown };
  if (
    spec.type !== "vector" &&
    spec.type !== "raster" &&
    spec.type !== "raster-dem"
  ) {
    return null;
  }
  if (
    Array.isArray(spec.tiles) &&
    spec.tiles.length > 0 &&
    spec.tiles.every((tile) => typeof tile === "string" && tile.length > 0)
  ) {
    return { kind: "tiles", tiles: spec.tiles as string[] };
  }
  if (typeof spec.url === "string" && spec.url.length > 0) {
    return { kind: "url", url: spec.url };
  }
  return null;
}

/** How long the next silent retry waits, given how many are already spent. */
export function silentTileRetryDelayMs(
  spent: number,
  baseDelayMs: number = TILE_SILENT_RETRY_BASE_DELAY_MS,
  maxDelayMs: number = TILE_SILENT_RETRY_MAX_DELAY_MS,
): number {
  const steps = Math.max(0, Math.floor(spent));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** steps);
}

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
export function isBasemapSourceMetadataFailure({
  message,
  sourceType,
  tilePresent,
}: Omit<CriticalBasemapFailureInput, "initialBasemapPending">): boolean {
  if (tilePresent || isStyleResourceFailure(message)) return false;
  return (
    sourceType === "vector" ||
    sourceType === "raster" ||
    sourceType === "raster-dem"
  );
}

export function isCriticalBasemapFailure({
  message,
  initialBasemapPending,
  sourceType,
  tilePresent,
}: CriticalBasemapFailureInput): boolean {
  if (isStyleResourceFailure(message)) return true;
  return (
    initialBasemapPending &&
    isBasemapSourceMetadataFailure({ message, sourceType, tilePresent })
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
  /**
   * The one bounded tile retry has already been spent on this source-URL-and-
   * viewport cycle. A new cycle (caller-scoped) arrives here as false.
   */
  retrySpent: boolean;
  /**
   * Silent source reloads still available. Zero means the invisible lane is
   * spent and the reader's own lanes take over.
   */
  silentRetriesLeft: number;
  /**
   * Basemap tiles that failed and have not since loaded. MapLibre re-asks for
   * none of them, so even one is a hole a source reload can close.
   */
  unrecoveredTileFailures?: number;
  /**
   * A sprite or glyph failed. A style resource, so the silent source lane
   * cannot answer it.
   */
  styleResourceFailure?: boolean;
  /**
   * TileJSON or another source-level metadata fetch failed with no tile in the
   * error. MapLibre emits one such error and marks the source settled, so the
   * silent source lane cannot help and the reader should be told immediately.
   */
  sourceMetadataFailure?: boolean;
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

export function tileFailureRecheckDelay(
  timestamps: readonly number[],
  now: number,
  burstThreshold: number = TILE_FAILURE_BURST,
  windowMs: number = TILE_FAILURE_WINDOW_MS,
  sustainMs: number = TILE_FAILURE_SUSTAIN_MS,
): number | null {
  const recent = pruneTileFailures(timestamps, now, windowMs);
  if (recent.length < burstThreshold) return null;
  return Math.max(0, sustainMs - (now - Math.min(...recent)));
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
    silentRetriesLeft,
    unrecoveredTileFailures = 0,
    styleResourceFailure = false,
    sourceMetadataFailure = false,
    initialBasemapPending = false,
    burstThreshold = TILE_FAILURE_BURST,
    windowMs = TILE_FAILURE_WINDOW_MS,
    sustainMs = TILE_FAILURE_SUSTAIN_MS,
  } = input;

  const reloadStyleOrSurface = (): TileFailureDecision =>
    !retrySpent && recoveryBudgetLeft > 0 ? "retry" : "surface";

  // A terminal source/style resource emits one error, then MapLibre marks it
  // loaded. Act now even if the tab is hidden or the camera is moving because
  // there may be no post-flight or foreground event to replay.
  if (criticalFailure) {
    // A sprite or glyph is the style's, not a source's: only setStyle re-fetches
    // it, so the silent lane would spend an attempt that cannot help.
    if (styleResourceFailure) return reloadStyleOrSurface();
    if (sourceMetadataFailure) return "surface";
    if (silentRetriesLeft > 0) return "retry-source";
    return reloadStyleOrSurface();
  }

  // A hidden tab aborts ordinary tile fetches as a matter of course.
  if (!documentVisible) return "ignore";
  // Mid-flight misses are the tile stream catching up to the camera, not a
  // failure. Stamps keep accumulating in the caller, so a genuine outage
  // escalates on the first post-flight error.
  if (cameraInFlight) return "ignore";

  const recent = pruneTileFailures(errorTimestamps, now, windowMs);
  const burstAge =
    recent.length > 0 ? now - Math.min(...recent) : 0;
  const sustainedBurst = recent.length >= burstThreshold && burstAge >= sustainMs;
  const initialBurst = initialBasemapPending && recent.length >= burstThreshold;
  const systemic = initialBurst || sustainedBurst;
  if (!systemic) {
    // Below the burst threshold a miss is routine, but the tile it lost is a
    // hole MapLibre will never re-request. One silent, backed-off source reload
    // closes it and the reader is told nothing, which is the whole point.
    return unrecoveredTileFailures > 0 && silentRetriesLeft > 0
      ? "retry-source"
      : "ignore";
  }

  if (silentRetriesLeft > 0) return "retry-source";
  return reloadStyleOrSurface();
}

/**
 * Whether a render or idle frame counts as a real basemap recovery, which
 * clears the burst stamps, ends the initial-basemap wait and hands the silent
 * budget back. MapLibre marks an errored tile as settled, so "tiles loaded" is
 * also true over a dead tile host, and while the first basemap is pending or
 * the camera is in flight no failed tile is recorded to hold it back. Without
 * a tile that really loaded in this style generation, a frame would wipe the
 * evidence of the outage and the map would never escalate or tell the reader.
 */
export function basemapRecoveryConfirmed({
  tilesLoaded,
  recheckPending,
  unrecoveredFailures,
  basemapTileLoaded,
}: {
  tilesLoaded: boolean;
  recheckPending: boolean;
  unrecoveredFailures: boolean;
  basemapTileLoaded: boolean;
}): boolean {
  return (
    tilesLoaded && !recheckPending && !unrecoveredFailures && basemapTileLoaded
  );
}

/**
 * A tile error that lands while the camera is in flight is ignored, and the
 * classifier waits for the next error after the flight to act on the stamps.
 * MapLibre never re-asks for a tile it failed, so when EVERY error lands inside
 * the flight (a dead tile host under the 1 s arrival turn) no later error comes,
 * and the map sits in no lane at all: no silent reload, no style reload, no
 * banner. So an ignored in-flight sample asks for one re-read at camera rest.
 */
export function tileFailureAwaitsCameraRest({
  decision,
  cameraInFlight,
  documentVisible,
}: {
  decision: TileFailureDecision;
  cameraInFlight: boolean;
  documentVisible: boolean;
}): boolean {
  return decision === "ignore" && cameraInFlight && documentVisible;
}

export type TileFailureSpendState = {
  /** Silent source reloads already spent since the last real basemap paint. */
  silentSpent: number;
  /** A silent source reload is waiting out its backoff. */
  silentQueued: boolean;
  retryQueued: boolean;
  retrySpent: boolean;
  surfaced: boolean;
};

export const INITIAL_TILE_FAILURE_SPEND: TileFailureSpendState = {
  silentSpent: 0,
  silentQueued: false,
  retryQueued: false,
  retrySpent: false,
  surfaced: false,
};

export type TileFailureSpendEffect =
  | "none"
  | "reload-source"
  | "reload-style"
  | "surface";

/** How many silent source reloads this state still has. */
export function silentTileRetriesLeft(
  state: TileFailureSpendState,
  maxRetries: number = TILE_SILENT_RETRY_MAX,
): number {
  return Math.max(0, maxRetries - state.silentSpent);
}

/**
 * Caller-side spend of `classifyTileFailure`. The silent source lane first,
 * then one style reload, then the honest surface. Never a second retry loop,
 * even if a later sample still says retry after the first reload was queued or
 * spent.
 */
export function spendTileFailureDecision(
  state: TileFailureSpendState,
  decision: TileFailureDecision,
  maxSilentRetries: number = TILE_SILENT_RETRY_MAX,
): { state: TileFailureSpendState; effect: TileFailureSpendEffect } {
  if (state.surfaced || decision === "ignore") {
    return { state, effect: "none" };
  }
  if (decision === "retry-source") {
    if (state.silentQueued || state.silentSpent >= maxSilentRetries) {
      return { state, effect: "none" };
    }
    return {
      state: { ...state, silentQueued: true },
      effect: "reload-source",
    };
  }
  if (decision === "retry") {
    if (state.retryQueued || state.retrySpent) {
      return { state, effect: "none" };
    }
    return {
      state: { ...state, retryQueued: true },
      effect: "reload-style",
    };
  }
  return { state, effect: "surface" };
}

export function markTileRetrySpent(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return { ...state, retryQueued: false, retrySpent: true };
}

/** A dispatched silent source reload. */
export function markSilentTileRetrySpent(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return { ...state, silentQueued: false, silentSpent: state.silentSpent + 1 };
}

/**
 * A silent reload that was queued and then abandoned (the style generation
 * moved on under it). It spent nothing, so it gives its place back rather than
 * blocking the next attempt for the life of the mount.
 */
export function releaseQueuedSilentTileRetry(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return { ...state, silentQueued: false };
}

/**
 * A basemap that really painted hands its silent budget back, so the next
 * flaky tile on a long session is met by the invisible lane rather than by the
 * style reload the reader can see.
 */
export function clearSilentTileRetries(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return { ...state, silentQueued: false, silentSpent: 0 };
}

export function markTileFailureSurfaced(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return { ...state, surfaced: true };
}

/**
 * Tiled basemap source identity, read off the serialized style sources the
 * same way `basemapSourceReloadPlan` does. GeoJSON overlays and sources with
 * no tile list or TileJSON url contribute nothing. Empty means the style is
 * mid-swap and the cycle must not change.
 */
export function basemapSourceIdentity(
  sources: Record<string, unknown> | null | undefined,
): string {
  if (!sources) return "";
  const parts: string[] = [];
  for (const [id, spec] of Object.entries(sources)) {
    const plan = basemapSourceReloadPlan(spec);
    if (!plan) continue;
    parts.push(
      plan.kind === "url" ? `${id}:${plan.url}` : `${id}:${plan.tiles.join(",")}`,
    );
  }
  return parts.sort().join("|");
}

/**
 * Integer zoom plus the Web Mercator tile that currently holds the viewport
 * centre. A pan that stays inside that tile is the same cycle; a pan onto a
 * new tile, or a zoom that changes z, is a new one. Read-only: this never
 * moves the camera.
 */
export function viewportTileKey(
  center: { lng: number; lat: number },
  zoom: number,
): string {
  const z = Math.max(0, Math.floor(zoom));
  const n = 2 ** z;
  const wrappedX = ((center.lng + 180) / 360) * n;
  const x = Math.floor(((wrappedX % n) + n) % n);
  const lat = Math.min(85.05112878, Math.max(-85.05112878, center.lat));
  const latRad = (lat * Math.PI) / 180;
  const yUnclamped = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  const y = Math.min(n - 1, Math.max(0, yUnclamped));
  return `${z}/${x}/${y}`;
}

/** Source-URL-and-viewport identity for one tile-retry cycle, or null when unknown. */
export function tileRetryCycleIdentity(
  sourceIdentity: string,
  viewportIdentity: string,
): string | null {
  if (!sourceIdentity || !viewportIdentity) return null;
  return `${sourceIdentity}@${viewportIdentity}`;
}

/**
 * Whether the mount's spent style reload still applies to this sample.
 * Unknown identity (style mid-swap) keeps the latch so a half-built style
 * cannot mint a second reload. A different cycle does not.
 */
export function retrySpentOnThisCycle({
  retrySpent,
  spentCycleIdentity,
  currentCycleIdentity,
}: {
  retrySpent: boolean;
  spentCycleIdentity: string | null;
  currentCycleIdentity: string | null;
}): boolean {
  if (!retrySpent) return false;
  if (currentCycleIdentity === null || spentCycleIdentity === null) {
    return true;
  }
  return spentCycleIdentity === currentCycleIdentity;
}

/** Drop the spent style-reload latch so a new cycle can climb the ladder. */
export function releaseTileRetryForNewCycle(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return {
    ...state,
    silentQueued: false,
    silentSpent: 0,
    retryQueued: false,
    retrySpent: false,
  };
}

/**
 * A basemap that really painted ends the cycle. Silent budget, style-reload
 * latch and the surfaced flag all go back, so the next outage is met by the
 * invisible lane rather than by a leftover toast.
 */
export function endTileRetryCycle(
  state: TileFailureSpendState,
): TileFailureSpendState {
  return {
    ...clearSilentTileRetries(state),
    retryQueued: false,
    retrySpent: false,
    surfaced: false,
  };
}

/**
 * Tile recovery cancelled the scene hang guard so a legitimate retry was not
 * blamed as a stuck box. Re-arm only when a recovery attempt actually begins
 * and the scene has not yet settled; a stall after that still owes the hang
 * notice. A later sample whose effect is `none` must not touch the timer.
 */
export function shouldRearmSceneHangGuard({
  sceneSettled,
  recoveryEffect,
}: {
  sceneSettled: boolean;
  recoveryEffect: TileFailureSpendEffect;
}): boolean {
  return (
    !sceneSettled &&
    (recoveryEffect === "reload-source" || recoveryEffect === "reload-style")
  );
}

/**
 * After the one bounded style reload is spent, which surface the caller
 * shows. A MapLibre `render` event is not a loaded style: empty frames fire
 * while both style URLs refuse. Toast is only honest when a style actually
 * loaded and later lost tiles. Otherwise the tiles card.
 */
export function basemapFailureSurface(styleEverLoaded: boolean): "toast" | "card" {
  // A failed replacement must not tear down a map that already drew. The
  // historical fact is the honest surface decision.
  return styleEverLoaded ? "toast" : "card";
}
