import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  INITIAL_TILE_FAILURE_SPEND,
  TILE_FAILURE_BURST,
  TILE_FAILURE_SUSTAIN_MS,
  TILE_FAILURE_WINDOW_MS,
  TILE_SILENT_RETRY_BASE_DELAY_MS,
  TILE_SILENT_RETRY_MAX,
  TILE_SILENT_RETRY_MAX_DELAY_MS,
  areBasemapTilesLoaded,
  basemapRecoveryConfirmed,
  basemapSourceReloadPlan,
  classifyTileFailure,
  clearSilentTileRetries,
  createBasemapTileFailureTracker,
  isCriticalBasemapFailure,
  isStyleResourceFailure,
  basemapFailureSurface,
  markSilentTileRetrySpent,
  markTileFailureSurfaced,
  markTileRetrySpent,
  pruneTileFailures,
  releaseQueuedSilentTileRetry,
  silentTileRetriesLeft,
  silentTileRetryDelayMs,
  spendTileFailureDecision,
  tileFailureAwaitsCameraRest,
  tileFailureRecheckDelay,
  type TileFailureInput,
} from "@/lib/mapTileFailure";

describe("areBasemapTilesLoaded", () => {
  it("treats the transient style-less theme-swap frame as not ready", () => {
    const map = {
      getStyle: () => undefined,
      areTilesLoaded: () => {
        throw new Error("must not inspect tiles without a style");
      },
      isSourceLoaded: () => {
        throw new Error("must not inspect sources without a style");
      },
    };

    expect(areBasemapTilesLoaded(map)).toBe(false);
  });

  it("requires every vector or raster source and ignores GeoJSON overlays", () => {
    const map = {
      getStyle: () => ({
        sources: {
          openfreemap: { type: "vector" },
          terrain: { type: "raster-dem" },
          landmarks: { type: "geojson" },
        },
      }),
      areTilesLoaded: () => true,
      isSourceLoaded: (id: string) => id !== "terrain",
    };

    expect(areBasemapTilesLoaded(map)).toBe(false);
    map.isSourceLoaded = () => true;
    expect(areBasemapTilesLoaded(map)).toBe(true);
  });
});

describe("createBasemapTileFailureTracker", () => {
  it("requires every failed tile to recover before confirming recovery", () => {
    const tracker = createBasemapTileFailureTracker();
    tracker.recordFailure({
      sourceId: "openfreemap",
      sourceType: "vector",
      tileKey: "12/2047/1360",
    });
    tracker.recordFailure({
      sourceId: "openfreemap",
      sourceType: "vector",
      tileKey: "12/2048/1360",
    });

    expect(
      tracker.recordSuccess({
        sourceId: "openfreemap",
        sourceType: "vector",
        tileKey: "12/2049/1360",
      }),
    ).toBe(false);
    expect(tracker.hasFailures()).toBe(true);
    expect(
      tracker.recordSuccess({
        sourceId: "openfreemap",
        sourceType: "vector",
        tileKey: "12/2047/1360",
      }),
    ).toBe(false);
    expect(tracker.hasFailures()).toBe(true);
    expect(
      tracker.recordSuccess({
        sourceId: "openfreemap",
        sourceType: "vector",
        tileKey: "12/2048/1360",
      }),
    ).toBe(true);
    expect(tracker.hasFailures()).toBe(false);
  });

  it("scopes failed tiles to the current generation", () => {
    const tracker = createBasemapTileFailureTracker();
    const tile = {
      sourceId: "openfreemap",
      sourceType: "vector",
      tileKey: "12/2047/1360",
    };
    tracker.recordFailure(tile);
    tracker.reset();

    expect(tracker.recordSuccess(tile)).toBe(false);
    expect(tracker.hasFailures()).toBe(false);
  });

  it("ignores non-basemap and incomplete tile references", () => {
    const tracker = createBasemapTileFailureTracker();
    tracker.recordFailure({
      sourceId: "pubs",
      sourceType: "geojson",
      tileKey: "pubs",
    });
    tracker.recordFailure({
      sourceType: "vector",
      tileKey: "12/2047/1360",
    });

    expect(tracker.hasFailures()).toBe(false);
  });
});

describe("isCriticalBasemapFailure", () => {
  it("treats initial vector TileJSON failure as systemic without a tile burst", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "vector",
        tilePresent: false,
      }),
    ).toBe(true);
  });

  it("does not promote an individual vector tile miss to critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "vector",
        tilePresent: true,
      }),
    ).toBe(false);
  });

  it("does not call a GeoJSON overlay or settled source critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "geojson",
        tilePresent: false,
      }),
    ).toBe(false);
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: false,
        sourceType: "vector",
        tilePresent: false,
      }),
    ).toBe(false);
  });

  it("keeps sprite and glyph failures critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "Could not load sprite image",
        initialBasemapPending: false,
        tilePresent: false,
      }),
    ).toBe(true);
    expect(
      isCriticalBasemapFailure({
        message: "Could not load glyph range",
        initialBasemapPending: false,
        tilePresent: false,
      }),
    ).toBe(true);
  });
});

// A visible, settled-camera tab with a sustained burst and a full budget the
// individual cases mutate. Every rule passes here, so each test flips exactly
// one field to prove that rule. The stamps span the sustain requirement while
// staying inside the window. The silent source lane is deliberately SPENT
// here, so each case below is about the reader-visible lanes it guards; the
// silent lane has its own describe block.
const NOW = 60_000;
const SPREAD = Math.ceil(TILE_FAILURE_SUSTAIN_MS / (TILE_FAILURE_BURST - 1)) + 100;
const burst = Array.from({ length: TILE_FAILURE_BURST }, (_, i) => NOW - i * SPREAD);
const bursting: TileFailureInput = {
  now: NOW,
  errorTimestamps: burst,
  criticalFailure: false,
  documentVisible: true,
  cameraInFlight: false,
  retrySpent: false,
  recoveryBudgetLeft: 5,
  silentRetriesLeft: 0,
};

describe("classifyTileFailure", () => {

  it("surfaces source metadata failure immediately instead of silent retry", () => {
    expect(
      classifyTileFailure({
        now: 0,
        errorTimestamps: [0],
        criticalFailure: true,
        documentVisible: true,
        cameraInFlight: false,
        retrySpent: false,
        recoveryBudgetLeft: 1,
        silentRetriesLeft: 2,
        styleResourceFailure: false,
        sourceMetadataFailure: true,
      }),
    ).toBe("surface");
  });

  it("spends the one retry on a sustained burst with budget left", () => {
    expect(classifyTileFailure(bursting)).toBe("retry");
  });

  it("ignores a lone transient tile miss", () => {
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: [NOW] }),
    ).toBe("ignore");
  });

  it("ignores a fast self-healing blip (burst count without sustained span)", () => {
    // The live-observed class: a camera flight paints black, tiles catch up in
    // under 5s. Enough errors to look like a burst, but the span is short.
    const blip = Array.from(
      { length: TILE_FAILURE_BURST + 2 },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: blip }),
    ).toBe("ignore");
  });

  it("reclassifies a concurrent post-paint outage after the sustain window", () => {
    const concurrent = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: concurrent }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        now: NOW + TILE_FAILURE_SUSTAIN_MS,
        errorTimestamps: concurrent,
      }),
    ).toBe("retry");
  });

  it("retries a concentrated burst while the initial basemap is still pending", () => {
    const initialBurst = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: initialBurst,
        initialBasemapPending: true,
      }),
    ).toBe("retry");
  });

  it("surfaces a repeated initial burst after the bounded retry", () => {
    const initialBurst = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: initialBurst,
        initialBasemapPending: true,
        retrySpent: true,
      }),
    ).toBe("surface");
  });

  it("ignores tile bursts but not terminal resources while the camera is in flight", () => {
    expect(
      classifyTileFailure({ ...bursting, cameraInFlight: true }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        cameraInFlight: true,
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("ignores errors that have aged out of the window", () => {
    const stale = burst.map((t) => t - (TILE_FAILURE_WINDOW_MS + SPREAD * TILE_FAILURE_BURST));
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: stale }),
    ).toBe("ignore");
  });

  it("treats one sprite/glyph failure as systemic on its own", () => {
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW],
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("ignores tile bursts but not terminal resources while the tab is hidden", () => {
    expect(
      classifyTileFailure({ ...bursting, documentVisible: false }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        documentVisible: false,
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("surfaces when the retry is already spent", () => {
    expect(classifyTileFailure({ ...bursting, retrySpent: true })).toBe(
      "surface",
    );
  });

  it("surfaces when the shared recovery budget is gone", () => {
    expect(
      classifyTileFailure({ ...bursting, recoveryBudgetLeft: 0 }),
    ).toBe("surface");
  });

  it("needs the full burst count even when the span is sustained", () => {
    const oneShort = burst.slice(0, TILE_FAILURE_BURST - 1);
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: oneShort }),
    ).toBe("ignore");
  });

  it("honors threshold, window, and sustain overrides", () => {
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW, NOW - 300],
        burstThreshold: 2,
        sustainMs: 200,
      }),
    ).toBe("retry");
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW, NOW - 600],
        burstThreshold: 2,
        windowMs: 500,
        sustainMs: 200,
      }),
    ).toBe("ignore");
  });
});

describe("pruneTileFailures", () => {
  it("keeps stamps inside the window and drops the aged", () => {
    const stamps = [NOW, NOW - TILE_FAILURE_WINDOW_MS, NOW - TILE_FAILURE_WINDOW_MS - 1];
    expect(pruneTileFailures(stamps, NOW)).toEqual([
      NOW,
      NOW - TILE_FAILURE_WINDOW_MS,
    ]);
  });

  it("respects a custom window", () => {
    expect(pruneTileFailures([NOW, NOW - 400, NOW - 600], NOW, 500)).toEqual([
      NOW,
      NOW - 400,
    ]);
  });
});

describe("tileFailureRecheckDelay", () => {
  it("arms one sustain-window recheck for a concentrated burst", () => {
    const concurrent = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(tileFailureRecheckDelay(concurrent, NOW)).toBe(
      TILE_FAILURE_SUSTAIN_MS - 300,
    );
  });

  it("does not arm below the burst threshold", () => {
    expect(
      tileFailureRecheckDelay(
        burst.slice(0, TILE_FAILURE_BURST - 1),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("spendTileFailureDecision", () => {
  it("spends the one style reload on a real systemic verdict, then surfaces", () => {
    const first = classifyTileFailure(bursting);
    expect(first).toBe("retry");

    const queued = spendTileFailureDecision(INITIAL_TILE_FAILURE_SPEND, first);
    expect(queued.effect).toBe("reload-style");
    expect(queued.state.retryQueued).toBe(true);

    // A second sample while the reload is in flight must not start another.
    expect(spendTileFailureDecision(queued.state, "retry").effect).toBe("none");

    const spent = markTileRetrySpent(queued.state);
    expect(spent.retrySpent).toBe(true);
    expect(spent.retryQueued).toBe(false);

    const afterReload = classifyTileFailure({ ...bursting, retrySpent: true });
    expect(afterReload).toBe("surface");

    const surfaced = spendTileFailureDecision(spent, afterReload);
    expect(surfaced.effect).toBe("surface");
    expect(spendTileFailureDecision(markTileFailureSurfaced(surfaced.state), "retry").effect).toBe(
      "none",
    );
    expect(
      spendTileFailureDecision(markTileFailureSurfaced(surfaced.state), "surface").effect,
    ).toBe("none");
  });

  it("never invents a second retry after the first reload is spent", () => {
    const spent = markTileRetrySpent({
      ...INITIAL_TILE_FAILURE_SPEND,
      retryQueued: true,
    });
    expect(spendTileFailureDecision(spent, "retry").effect).toBe("none");
    expect(spendTileFailureDecision(spent, "surface").effect).toBe("surface");
  });
});

describe("basemapFailureSurface", () => {
  it("shows the tiles card when no style ever loaded", () => {
    expect(basemapFailureSurface(false)).toBe("card");
  });

  it("keeps the toast when a previously loaded style is being replaced", () => {
    expect(basemapFailureSurface(true)).toBe("toast");
  });
});

// The silent source lane (#1488). MapLibre never re-asks for a tile it failed,
// so a transient outage used to leave a permanent hole whose only way out was
// the style reload the reader can see - and, one round later, the banner.
// These hold the lane to being invisible, bounded, and never in front of the
// failure classes it cannot fix.
describe("the silent basemap-source retry lane", () => {
  const withSilentBudget = (patch: Partial<TileFailureInput> = {}) => ({
    ...bursting,
    silentRetriesLeft: TILE_SILENT_RETRY_MAX,
    ...patch,
  });

  it("takes a sustained burst before the style reload does", () => {
    expect(classifyTileFailure(withSilentBudget())).toBe("retry-source");
  });

  it("takes a cold-load burst before the style reload does", () => {
    const initialBurst = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure(
        withSilentBudget({
          errorTimestamps: initialBurst,
          initialBasemapPending: true,
        }),
      ),
    ).toBe("retry-source");
  });

  it("closes a lone unrecovered tile hole no burst would ever reach", () => {
    expect(
      classifyTileFailure(
        withSilentBudget({
          errorTimestamps: [NOW],
          unrecoveredTileFailures: 1,
        }),
      ),
    ).toBe("retry-source");
  });

  it("leaves a lone miss that already recovered alone", () => {
    expect(
      classifyTileFailure(
        withSilentBudget({
          errorTimestamps: [NOW],
          unrecoveredTileFailures: 0,
        }),
      ),
    ).toBe("ignore");
  });

  it("stays out of a hidden tab and a camera in flight", () => {
    expect(
      classifyTileFailure(
        withSilentBudget({ documentVisible: false, unrecoveredTileFailures: 3 }),
      ),
    ).toBe("ignore");
    expect(
      classifyTileFailure(
        withSilentBudget({ cameraInFlight: true, unrecoveredTileFailures: 3 }),
      ),
    ).toBe("ignore");
  });

  it("hands a spent lane back to the style reload, then to the banner", () => {
    expect(classifyTileFailure({ ...bursting, silentRetriesLeft: 0 })).toBe(
      "retry",
    );
    expect(
      classifyTileFailure({
        ...bursting,
        silentRetriesLeft: 0,
        retrySpent: true,
      }),
    ).toBe("surface");
  });

  it("never stands in front of a sprite or glyph, which no source can re-fetch", () => {
    expect(isStyleResourceFailure("Unable to load sprite")).toBe(true);
    expect(isStyleResourceFailure("Could not load glyph range")).toBe(true);
    expect(isStyleResourceFailure("Failed to fetch tile")).toBe(false);
    expect(
      classifyTileFailure(
        withSilentBudget({
          errorTimestamps: [NOW],
          criticalFailure: true,
          styleResourceFailure: true,
        }),
      ),
    ).toBe("retry");
  });

  it("does answer terminal source metadata, which a source reload can re-ask", () => {
    expect(
      classifyTileFailure(
        withSilentBudget({ errorTimestamps: [NOW], criticalFailure: true }),
      ),
    ).toBe("retry-source");
  });

  it("backs off, and stops doubling at the ceiling", () => {
    expect(silentTileRetryDelayMs(0)).toBe(TILE_SILENT_RETRY_BASE_DELAY_MS);
    expect(silentTileRetryDelayMs(1)).toBe(TILE_SILENT_RETRY_BASE_DELAY_MS * 2);
    expect(silentTileRetryDelayMs(20)).toBe(TILE_SILENT_RETRY_MAX_DELAY_MS);
  });
});

// A dead tile host can spend every error inside the 1 s arrival turn. MapLibre
// never re-asks for those tiles, so no error follows the turn, and without a
// re-read at rest the map took no lane and told the reader nothing
// (e2e/map-tile-retry.spec.ts "tiles never come back").
describe("a tile burst that lands inside a camera flight", () => {
  const coldBurst = Array.from({ length: TILE_FAILURE_BURST }, (_, i) => NOW - i * 10);

  it("asks for one re-read at rest only for an ignored in-flight sample on a visible tab", () => {
    expect(
      tileFailureAwaitsCameraRest({
        decision: "ignore",
        cameraInFlight: true,
        documentVisible: true,
      }),
    ).toBe(true);
    expect(
      tileFailureAwaitsCameraRest({
        decision: "ignore",
        cameraInFlight: false,
        documentVisible: true,
      }),
    ).toBe(false);
    expect(
      tileFailureAwaitsCameraRest({
        decision: "ignore",
        cameraInFlight: true,
        documentVisible: false,
      }),
    ).toBe(false);
    expect(
      tileFailureAwaitsCameraRest({
        decision: "retry-source",
        cameraInFlight: true,
        documentVisible: true,
      }),
    ).toBe(false);
  });

  it("enters the silent lane at rest from the stamps the flight ignored", () => {
    const sample = {
      ...bursting,
      errorTimestamps: coldBurst,
      initialBasemapPending: true,
      silentRetriesLeft: TILE_SILENT_RETRY_MAX,
    };
    expect(classifyTileFailure({ ...sample, cameraInFlight: true })).toBe("ignore");
    expect(classifyTileFailure({ ...sample, now: NOW + 1_000 })).toBe("retry-source");
  });

  it("keeps the stamps when a frame over errored tiles only looks settled", () => {
    const settledOverErrors = {
      tilesLoaded: true,
      recheckPending: false,
      unrecoveredFailures: false,
      basemapTileLoaded: false,
    };
    expect(basemapRecoveryConfirmed(settledOverErrors)).toBe(false);
    expect(
      basemapRecoveryConfirmed({ ...settledOverErrors, basemapTileLoaded: true }),
    ).toBe(true);
    expect(
      basemapRecoveryConfirmed({
        ...settledOverErrors,
        basemapTileLoaded: true,
        unrecoveredFailures: true,
      }),
    ).toBe(false);
    expect(
      basemapRecoveryConfirmed({
        ...settledOverErrors,
        basemapTileLoaded: true,
        recheckPending: true,
      }),
    ).toBe(false);
    expect(
      basemapRecoveryConfirmed({
        ...settledOverErrors,
        basemapTileLoaded: true,
        tilesLoaded: false,
      }),
    ).toBe(false);
  });

  it("is armed by the canvas on moveend and re-reads the same stamps", () => {
    const canvas = readFileSync(
      path.join(process.cwd(), "components/PubMapCanvas.tsx"),
      "utf8",
    );
    const branch = canvas.slice(
      canvas.indexOf("tileFailureAwaitsCameraRest({"),
      canvas.indexOf("const delay = initialBasemapPending"),
    );
    expect(branch).toContain('map.once("moveend"');
    expect(branch).toContain("generation !== tileFailureGeneration");
    expect(branch).toContain("evaluateTileFailure(");
  });
});

describe("spending the silent lane", () => {
  it("queues one reload at a time and stops at the cap", () => {
    let state = INITIAL_TILE_FAILURE_SPEND;
    expect(silentTileRetriesLeft(state)).toBe(TILE_SILENT_RETRY_MAX);

    const first = spendTileFailureDecision(state, "retry-source");
    expect(first.effect).toBe("reload-source");
    state = first.state;
    // A second sample while the first is still waiting out its backoff must
    // not stack a second reload on top of it.
    expect(spendTileFailureDecision(state, "retry-source").effect).toBe("none");

    state = markSilentTileRetrySpent(state);
    expect(silentTileRetriesLeft(state)).toBe(TILE_SILENT_RETRY_MAX - 1);
    state = markSilentTileRetrySpent(
      spendTileFailureDecision(state, "retry-source").state,
    );
    expect(silentTileRetriesLeft(state)).toBe(0);
    expect(spendTileFailureDecision(state, "retry-source").effect).toBe("none");
    // The reader-visible lane is untouched by everything above.
    expect(state.retrySpent).toBe(false);
    expect(spendTileFailureDecision(state, "retry").effect).toBe("reload-style");
  });

  it("gives an abandoned queued reload its place back", () => {
    const queued = spendTileFailureDecision(
      INITIAL_TILE_FAILURE_SPEND,
      "retry-source",
    ).state;
    const released = releaseQueuedSilentTileRetry(queued);
    expect(released.silentSpent).toBe(0);
    expect(spendTileFailureDecision(released, "retry-source").effect).toBe(
      "reload-source",
    );
  });

  it("hands the whole budget back once the basemap really painted", () => {
    let state = INITIAL_TILE_FAILURE_SPEND;
    for (let i = 0; i < TILE_SILENT_RETRY_MAX; i += 1) {
      state = markSilentTileRetrySpent(
        spendTileFailureDecision(state, "retry-source").state,
      );
    }
    expect(silentTileRetriesLeft(state)).toBe(0);
    expect(silentTileRetriesLeft(clearSilentTileRetries(state))).toBe(
      TILE_SILENT_RETRY_MAX,
    );
  });

  it("spends nothing at all once the reader has been told", () => {
    const surfaced = markTileFailureSurfaced(INITIAL_TILE_FAILURE_SPEND);
    expect(spendTileFailureDecision(surfaced, "retry-source").effect).toBe(
      "none",
    );
  });
});

describe("basemapSourceReloadPlan", () => {
  it("re-asks an explicit tile list by its own tiles", () => {
    expect(
      basemapSourceReloadPlan({
        type: "raster",
        tiles: ["https://tiles.example/{z}/{x}/{y}.png"],
      }),
    ).toEqual({
      kind: "tiles",
      tiles: ["https://tiles.example/{z}/{x}/{y}.png"],
    });
  });

  it("re-asks a TileJSON source by its url, which is what production ships", () => {
    expect(
      basemapSourceReloadPlan({
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
      }),
    ).toEqual({ kind: "url", url: "https://tiles.openfreemap.org/planet" });
  });

  it("leaves every source that is not a tiled basemap alone", () => {
    expect(
      basemapSourceReloadPlan({ type: "geojson", data: { type: "FeatureCollection" } }),
    ).toBeNull();
    expect(basemapSourceReloadPlan({ type: "vector" })).toBeNull();
    expect(basemapSourceReloadPlan({ type: "raster", tiles: [] })).toBeNull();
    expect(basemapSourceReloadPlan(undefined)).toBeNull();
    expect(basemapSourceReloadPlan("openfreemap")).toBeNull();
  });
});

describe("createBasemapTileFailureTracker counts", () => {
  it("counts only the tiles that failed and have not since loaded", () => {
    const tracker = createBasemapTileFailureTracker();
    expect(tracker.count()).toBe(0);
    tracker.recordFailure({ sourceId: "base", sourceType: "raster", tileKey: "a" });
    tracker.recordFailure({ sourceId: "base", sourceType: "raster", tileKey: "b" });
    expect(tracker.count()).toBe(2);
    tracker.recordSuccess({ sourceId: "base", sourceType: "raster", tileKey: "a" });
    expect(tracker.count()).toBe(1);
    tracker.reset();
    expect(tracker.count()).toBe(0);
  });
});
