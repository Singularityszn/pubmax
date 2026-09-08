import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tilePolicy from "@/lib/mapTileFailure";
import * as pinReveal from "@/components/map/canvas/pinRevealCoordinator";
import { appDataPackSourceId } from "@/lib/mapDataPackFailure";
import { PAINT_WATCHDOG_MAX_RETRIES } from "@/lib/mapPaintWatchdog";

const component = readFileSync("components/PubMapCanvas.tsx", "utf8");

function callerBlock(start: string, end: string): string {
  const from = component.indexOf(start);
  const until = component.indexOf(end, from);
  if (from < 0 || until < 0) throw new Error(`Missing caller block: ${start}`);
  return component.slice(from, until);
}

// Execute the installed engine's readiness read. Its errored tiles are settled,
// so the component must prove recovery independently of this engine answer.
function installedTilesLoaded(states: Map<string, string>): () => boolean {
  const source = readFileSync("node_modules/maplibre-gl/src/tile/tile_manager.ts", "utf8");
  const start = source.indexOf("    areTilesLoaded(): boolean {");
  const end = source.indexOf("\n    }", start) + 6;
  if (start < 0 || end <= start) throw new Error("Missing MapLibre readiness method");
  const emitted = ts.transpileModule(`return class { ${source.slice(start, end)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Constructor = new Function(emitted)() as new () => {
    _inViewTiles: { getAllTiles: () => Array<{ state: string }> };
    areTilesLoaded: () => boolean;
  };
  const manager = new Constructor();
  manager._inViewTiles = { getAllTiles: () => [...states.values()].map(state => ({ state })) };
  return () => manager.areTilesLoaded();
}

function recoveryCaller(phoneFirstImpression = false) {
  const states = new Map<string, string>();
  let moving = false;
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const emit = (name: string, event?: unknown) => {
    for (const handler of [...(listeners.get(name) ?? [])]) handler(event);
  };
  const setTiles = vi.fn(() => {
    for (const id of states.keys()) states.set(id, "loading");
  });
  const map = {
    getStyle: () => ({ sources: { basemap: { type: "raster", tiles: ["https://tiles.invalid/{z}/{x}/{y}.png"] } } }),
    getSource: () => ({ setTiles }),
    areTilesLoaded: installedTilesLoaded(states),
    isSourceLoaded: () => true,
    isMoving: () => moving,
    getBearing: () => -8,
    getPitch: () => 38,
    getLayer: () => true,
    setLayoutProperty: vi.fn(),
    triggerRepaint: vi.fn(),
    on: (name: string, handler: (event?: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(handler);
    },
    off: (name: string, handler: (event?: unknown) => void) => listeners.get(name)?.delete(handler),
  };
  const setProtectedStyle = vi.fn();
  const surfaceBasemapFailure = vi.fn();
  const retireTilesNotice = vi.fn();
  let notice: { kind: string; message: string } | null = null;
  const setSoftRetry = vi.fn((update) => {
    notice = typeof update === "function" ? update(notice) : update;
  });
  const dispatchEvent = vi.fn();
  const { areBasemapTilesLoaded: readBasemapTilesLoaded, ...tileImports } = tilePolicy;
  const scope = {
    ...tileImports,
    ...pinReveal,
    readBasemapTilesLoaded,
    appDataPackSourceId,
    PAINT_WATCHDOG_MAX_RETRIES,
    map,
    mapRef: { current: map },
    document: { visibilityState: "visible" },
    retireTilesNotice,
    setProtectedStyle,
    surfaceBasemapFailure,
    recoverDataPack: vi.fn(),
    swapToBasemapFallback: vi.fn(),
    themeRef: { current: "light" },
    MAP_STYLES: { light: "primary" },
    FALLBACK_STYLES: { light: "fallback" },
    cancelDeferredWork: vi.fn(),
    clearStyleLoadProtection: vi.fn(),
    buildScene: vi.fn(),
    phoneFirstImpression,
    hasPinsPaintable: () => true,
    venueDataFailedRef: { current: false },
    venueDataReadyRef: { current: true },
    venueRetrySpentRef: { current: false },
    armPinNoticeRef: { current: null },
    onMapReadyRef: { current: vi.fn() },
    markPubmaxTiming: vi.fn(),
    startPinEntrance: vi.fn(),
    setSoftRetry,
    setMapBearing: vi.fn(),
    setMapPitch: vi.fn(),
    publishCurrentViewport: vi.fn(),
    gestureCameraRef: { current: { active: false, endedAt: null } },
    window: { setTimeout, clearTimeout, dispatchEvent },
    CustomEvent: class { constructor(public type: string, public options: unknown) {} },
    MAP_PIN_REVEAL_EVENT: "pubmax:pin-reveal",
    PUB_PIN_LAYERS: ["pubs-point"],
  };
  const emitted = ts.transpileModule(`
    let styleLoaded = true, usingFallback = false, recoverySpent = 0;
    let styleGeneration = 0, protectedStyleInFlight = false, queuedProtectedStyle = null;
    ${callerBlock("const PIN_REVEAL_TIMEOUT_MS =", "// First-painted-frame watchdog.")}
    const styleStructureReadyRef = { current: false };
    const liveGestures = new Set();
    ${callerBlock('map.on("moveend", () => {', "// Pure rotation or tilt")}
    ${callerBlock("const areBasemapTilesLoaded =", "const hasPinsPaintable =")}
    ${callerBlock("let pinNoticeActive =", "const retireTilesNotice =")}
    ${callerBlock("armPinNoticeRef.current =", "// The pin Retry spends")}
    ${callerBlock("const markBasemapRecovered =", '// The moment the venue rows are paintable:')}
    ${callerBlock("const pinRevealCoordinator =", "const buildScene =")}
    ${callerBlock('map.on("style.load", () => {', '// Initial load shares theme/fallback')}
    ${callerBlock("const evaluateTileFailure =", "// --- Post-init context loss")}
    return {
      pending: () => initialBasemapPending,
      showTimeout: () => { tileNoticeOwner = "timeout"; },
      showError: () => { tileNoticeOwner = "errors"; },
      dispose: () => {
        ${callerBlock("      pinRevealCoordinator.dispose();", "      clearPinRetryWait();")}
      },
      finishSceneBuild: () => {
        ${callerBlock("      // --- Tile-paint gate (D2).", "      // Flush any mutations")}
      },
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const caller = new Function(...Object.keys(scope), emitted)(...Object.values(scope)) as {
    pending: () => boolean;
    showTimeout: () => void;
    showError: () => void;
    dispose: () => void;
    finishSceneBuild: () => void;
  };
  const tileEvent = (id: string) => ({ sourceId: "basemap", source: { type: "raster" }, tile: { state: states.get(id), tileID: { key: id } }, error: new Error("Tile fetch failed") });
  return {
    ...caller, setTiles, setProtectedStyle, surfaceBasemapFailure, retireTilesNotice,
    setSoftRetry, dispatchEvent,
    notice: () => notice,
    failVenues: () => {
      scope.venueDataFailedRef.current = true;
      (scope.armPinNoticeRef.current as (() => void) | null)?.();
      setSoftRetry(pinReveal.VENUE_DATA_RETRY_NOTICE);
    },
    recoverVenues: () => { scope.venueDataFailedRef.current = false; },
    styleLoaded: () => emit("style.load"),
    startMoving: () => { moving = true; },
    leaveViewport: (...ids: string[]) => { for (const id of ids) states.delete(id); },
    stopMoving: () => { moving = false; emit("moveend"); },
    fail(id: string) {
      states.set(id, "errored");
      emit("error", tileEvent(id));
    },
    load(id: string) {
      states.set(id, "loaded");
      emit("sourcedata", tileEvent(id));
    },
    render: () => emit("render"),
  };
}

// Replay the two batches from the retained 5145 browser caller trace.
// A source retry can select parent tiles, so the second batch uses new keys.
async function settledOutageThroughSilentRetries() {
  const caller = recoveryCaller();
  const first = ["da77hdd", "da77gdd", "dadj1dd", "da0vxdd", "da0vwdd"];
  const next = ["3bj0ecc", "3bm66cc", "dadj0dd"];
  const parents = ["tvcvbb", "twxrbb"];
  caller.load("initial");
  caller.render();
  for (const id of first) caller.fail(id);
  await vi.advanceTimersByTimeAsync(340);
  caller.load("dadj0dd");
  caller.render();
  await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(0) - 340);
  expect(caller.setTiles).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1_030);
  for (const id of next) caller.fail(id);
  await vi.advanceTimersByTimeAsync(1_019);
  for (const id of parents) caller.fail(id);
  await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(1) - 1_019);
  expect(caller.setTiles).toHaveBeenCalledTimes(2);
  expect(caller.setProtectedStyle).not.toHaveBeenCalled();
  return { caller, oldKeys: ["initial", ...first, ...next, ...parents] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("component basemap recovery with MapLibre settled errors", () => {
  it("retains a settled outage when the last silent reload emits no more errors", async () => {
    const { caller } = await settledOutageThroughSilentRetries();
    // No new error, render, or loaded event may be needed to resume recovery.
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_SUSTAIN_MS);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
    caller.styleLoaded();
    for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_WINDOW_MS);
    expect(caller.surfaceBasemapFailure).toHaveBeenCalled();
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
  });

  it("retires retained evidence when the final source attempt succeeds", async () => {
    const { caller, oldKeys } = await settledOutageThroughSilentRetries();
    for (const id of oldKeys) caller.load(id);
    caller.render();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_WINDOW_MS);
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    expect(caller.surfaceBasemapFailure).not.toHaveBeenCalled();
    // A real recovery restores the existing silent budget for a later miss.
    caller.fail("later-miss");
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(0));
    expect(caller.setTiles).toHaveBeenCalledTimes(3);
  });

  it("does not require abandoned tile keys after a healthy viewport replaces them", async () => {
    const { caller, oldKeys } = await settledOutageThroughSilentRetries();
    caller.startMoving();
    caller.leaveViewport(...oldKeys);
    caller.load("healthy-final-viewport");
    caller.stopMoving();
    caller.render();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_WINDOW_MS);
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    expect(caller.surfaceBasemapFailure).not.toHaveBeenCalled();
  });

  it("keeps the sustain check when one retry tile loads but the source stays pending", async () => {
    const { caller } = await settledOutageThroughSilentRetries();
    caller.load("unrelated-retry-success");
    caller.render();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_SUSTAIN_MS);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
  });

  it.each(["replacement", "disposal"])("cancels a silent-attempt recheck after %s", async (end) => {
    const { caller } = await settledOutageThroughSilentRetries();
    if (end === "replacement") caller.styleLoaded();
    else caller.dispose();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_WINDOW_MS);
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    expect(caller.surfaceBasemapFailure).not.toHaveBeenCalled();
  });

  it("rechecks delivered tile failures after motion stops without another error", async () => {
    const caller = recoveryCaller();
    caller.load("initial");
    caller.render();
    caller.startMoving();
    for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    caller.render();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_SUSTAIN_MS);
    expect(caller.setTiles).not.toHaveBeenCalled();
    caller.stopMoving();
    caller.render();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(0));
    expect(caller.setTiles).toHaveBeenCalledOnce();
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(1));
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_WINDOW_MS);
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
  });

  it("revisits a sustain check that expires during later camera motion", async () => {
    const caller = recoveryCaller();
    caller.load("initial");
    caller.render();
    const failViewport = () => {
      for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    };
    failViewport();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(0));
    failViewport();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(1));
    failViewport();
    caller.startMoving();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_SUSTAIN_MS);
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    caller.stopMoving();
    caller.render();
    await vi.advanceTimersByTimeAsync(0);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
  });

  it("does not retry failures left behind when the final viewport loads", async () => {
    const caller = recoveryCaller();
    caller.load("initial");
    caller.render();
    caller.startMoving();
    for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    caller.leaveViewport("initial", "a", "b", "c", "d");
    caller.load("healthy-final-viewport");
    caller.stopMoving();
    caller.render();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_WINDOW_MS);
    expect(caller.setTiles).not.toHaveBeenCalled();
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    expect(caller.surfaceBasemapFailure).not.toHaveBeenCalled();
  });

  it.each(["replacement", "disposal"])("discards motion recovery after %s", async (end) => {
    const caller = recoveryCaller();
    caller.load("initial");
    caller.render();
    caller.startMoving();
    for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    if (end === "replacement") caller.styleLoaded();
    else caller.dispose();
    caller.stopMoving();
    await vi.advanceTimersByTimeAsync(tilePolicy.TILE_FAILURE_WINDOW_MS);
    expect(caller.setTiles).not.toHaveBeenCalled();
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    expect(caller.surfaceBasemapFailure).not.toHaveBeenCalled();
  });

  it("hands an expired basemap deadline the notice after the pub list recovers", async () => {
    const caller = recoveryCaller(true);
    caller.styleLoaded();
    caller.finishSceneBuild();
    caller.render();
    caller.render();
    await vi.advanceTimersByTimeAsync(500);
    caller.failVenues();
    await vi.advanceTimersByTimeAsync(11_500);
    expect(caller.notice()).toEqual(pinReveal.VENUE_DATA_RETRY_NOTICE);
    caller.recoverVenues();
    caller.render();
    expect(caller.notice()).toEqual(pinReveal.BASEMAP_RETRY_NOTICE);
    expect(caller.dispatchEvent).toHaveBeenCalledOnce();
  });

  it.each(["loaded", "replacement", "disposed"] as const)(
    "does not hand off an expired deadline after %s",
    async (outcome) => {
      const caller = recoveryCaller(true);
      caller.styleLoaded();
      caller.finishSceneBuild();
      caller.render();
      caller.render();
      await vi.advanceTimersByTimeAsync(500);
      caller.failVenues();
      await vi.advanceTimersByTimeAsync(11_500);
      if (outcome === "loaded") caller.load("a");
      if (outcome === "replacement") caller.styleLoaded();
      if (outcome === "disposed") caller.dispose();
      caller.recoverVenues();
      caller.render();
      expect(caller.notice()).toBeNull();
    },
  );

  it("reports a held basemap after phone pins reveal without revealing them twice", async () => {
    const caller = recoveryCaller(true);
    caller.styleLoaded();
    caller.finishSceneBuild();
    caller.render();
    caller.render();
    await vi.advanceTimersByTimeAsync(500);
    expect(caller.dispatchEvent).toHaveBeenCalledOnce();
    expect(caller.dispatchEvent.mock.calls[0][0].options.detail.reason).toBe("pins");
    expect(caller.setSoftRetry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(11_500);
    expect(caller.setSoftRetry).toHaveBeenCalledExactlyOnceWith(pinReveal.BASEMAP_RETRY_NOTICE);
    expect(caller.dispatchEvent).toHaveBeenCalledOnce();
    caller.load("a");
    caller.render();
    expect(caller.retireTilesNotice).toHaveBeenCalledOnce();
  });

  it.each(["loaded", "error", "replacement", "disposed"] as const)(
    "does not publish a phone deadline after %s",
    async (outcome) => {
      const caller = recoveryCaller(true);
      caller.styleLoaded();
      caller.finishSceneBuild();
      caller.render();
      caller.render();
      await vi.advanceTimersByTimeAsync(500);
      if (outcome === "loaded") caller.load("a");
      if (outcome === "error") caller.showError();
      if (outcome === "replacement") caller.styleLoaded();
      if (outcome === "disposed") caller.dispose();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(caller.setSoftRetry).not.toHaveBeenCalled();
      expect(caller.dispatchEvent).toHaveBeenCalledOnce();
    },
  );

  it("publishes only one notice when the phone reveal itself reaches its ceiling", async () => {
    const caller = recoveryCaller(true);
    caller.styleLoaded();
    caller.finishSceneBuild();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(caller.setSoftRetry).toHaveBeenCalledExactlyOnceWith(pinReveal.BASEMAP_RETRY_NOTICE);
    expect(caller.dispatchEvent).toHaveBeenCalledOnce();
    expect(caller.dispatchEvent.mock.calls[0][0].options.detail.reason).toBe("timeout");
  });

  it("cancels a queued source retry when a replacement style loads", async () => {
    const caller = recoveryCaller();
    caller.styleLoaded();
    for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    caller.styleLoaded();
    caller.finishSceneBuild();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(0));
    expect(caller.setTiles).not.toHaveBeenCalled();
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
  });

  it("keeps successful basemap paint across deferred scene work", () => {
    const caller = recoveryCaller();
    caller.styleLoaded();
    caller.load("a");
    caller.finishSceneBuild();
    caller.showTimeout();
    caller.render();
    expect(caller.pending()).toBe(false);
    expect(caller.retireTilesNotice).toHaveBeenCalledOnce();
  });

  it("keeps fast tile errors when the deferred app scene finishes", async () => {
    const caller = recoveryCaller();
    caller.styleLoaded();
    const failViewport = () => {
      for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    };
    failViewport();
    caller.finishSceneBuild();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(0));
    expect(caller.setTiles).toHaveBeenCalledOnce();
    failViewport();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(1));
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
    failViewport();
    await vi.advanceTimersByTimeAsync(0);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
  });

  it("keeps the initial silent retry when an all-errored viewport renders", () => {
    const caller = recoveryCaller();
    for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    caller.render();
    vi.advanceTimersByTime(tilePolicy.TILE_SILENT_RETRY_BASE_DELAY_MS);
    expect(caller.setTiles).toHaveBeenCalledOnce();
    expect(caller.pending()).toBe(true);
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
  });

  it("retires a timeout only after successful tiles, not an errored render", () => {
    const caller = recoveryCaller();
    caller.showTimeout();
    caller.fail("a");
    caller.render();
    expect(caller.retireTilesNotice).not.toHaveBeenCalled();
    caller.load("a");
    caller.render();
    expect(caller.retireTilesNotice).toHaveBeenCalledOnce();
    expect(caller.pending()).toBe(false);
  });

  it("recovers silently after a retry receives successful tiles", () => {
    const caller = recoveryCaller();
    for (const id of ["a", "b", "c", "d"]) caller.fail(id);
    vi.advanceTimersByTime(tilePolicy.TILE_SILENT_RETRY_BASE_DELAY_MS);
    for (const id of ["a", "b", "c", "d"]) caller.load(id);
    caller.render();
    vi.advanceTimersByTime(10_000);
    expect(caller.setTiles).toHaveBeenCalledOnce();
    expect(caller.setProtectedStyle).not.toHaveBeenCalled();
    expect(caller.surfaceBasemapFailure).not.toHaveBeenCalled();
    expect(caller.pending()).toBe(false);
  });

  it("does not let one successful tile hide another initial failure", () => {
    const caller = recoveryCaller();
    caller.showTimeout();
    caller.fail("a");
    caller.load("b");
    caller.render();
    expect(caller.retireTilesNotice).not.toHaveBeenCalled();
    caller.load("a");
    expect(caller.retireTilesNotice).toHaveBeenCalledOnce();
  });

  it("keeps the bounded style reload and notice for permanent tile failures", async () => {
    const caller = recoveryCaller();
    const failViewport = () => {
      for (const id of ["a", "b", "c", "d"]) caller.fail(id);
      caller.render();
    };
    failViewport();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(0));
    failViewport();
    await vi.advanceTimersByTimeAsync(tilePolicy.silentTileRetryDelayMs(1));
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
    failViewport();
    await vi.advanceTimersByTimeAsync(0);
    expect(caller.setProtectedStyle).toHaveBeenCalledOnce();
    failViewport();
    expect(caller.surfaceBasemapFailure).toHaveBeenCalled();
    expect(caller.setTiles).toHaveBeenCalledTimes(2);
  });
});
