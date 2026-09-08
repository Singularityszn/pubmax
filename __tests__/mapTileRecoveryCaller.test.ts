import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tilePolicy from "@/lib/mapTileFailure";
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

function recoveryCaller() {
  const states = new Map<string, string>();
  const listeners = new Map<string, (event?: unknown) => void>();
  const setTiles = vi.fn(() => {
    for (const id of states.keys()) states.set(id, "loading");
  });
  const map = {
    getStyle: () => ({ sources: { basemap: { type: "raster", tiles: ["https://tiles.invalid/{z}/{x}/{y}.png"] } } }),
    getSource: () => ({ setTiles }),
    areTilesLoaded: installedTilesLoaded(states),
    isSourceLoaded: () => true,
    isMoving: () => false,
    on: (name: string, handler: (event?: unknown) => void) => {
      const previous = listeners.get(name);
      listeners.set(name, (event) => { previous?.(event); handler(event); });
    },
  };
  const setProtectedStyle = vi.fn();
  const surfaceBasemapFailure = vi.fn();
  const retireTilesNotice = vi.fn();
  const { areBasemapTilesLoaded: readBasemapTilesLoaded, ...tileImports } = tilePolicy;
  const scope = {
    ...tileImports,
    readBasemapTilesLoaded,
    appDataPackSourceId,
    PAINT_WATCHDOG_MAX_RETRIES,
    map,
    mapRef: { current: map },
    document: { visibilityState: "visible" },
    markPinsRecovered: vi.fn(),
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
    pinRevealCoordinator: { arm: vi.fn() },
  };
  const emitted = ts.transpileModule(`
    let styleLoaded = true, usingFallback = false, recoverySpent = 0;
    let styleGeneration = 0, protectedStyleInFlight = false, queuedProtectedStyle = null;
    const styleStructureReadyRef = { current: false };
    ${callerBlock("const areBasemapTilesLoaded =", "const hasPinsPaintable =")}
    ${callerBlock("const markBasemapRecovered =", '// The moment the venue rows are paintable:')}
    ${callerBlock('map.on("style.load", () => {', '// Initial load shares theme/fallback')}
    ${callerBlock("const evaluateTileFailure =", "// --- Post-init context loss")}
    return {
      pending: () => initialBasemapPending,
      showTimeout: () => { tileNoticeOwner = "timeout"; },
      finishSceneBuild: () => {
        ${callerBlock("      // --- Tile-paint gate (D2).", "      // Flush any mutations")}
      },
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const caller = new Function(...Object.keys(scope), emitted)(...Object.values(scope)) as {
    pending: () => boolean;
    showTimeout: () => void;
    finishSceneBuild: () => void;
  };
  const tileEvent = (id: string) => ({ sourceId: "basemap", source: { type: "raster" }, tile: { state: states.get(id), tileID: { key: id } }, error: new Error("Tile fetch failed") });
  return {
    ...caller, setTiles, setProtectedStyle, surfaceBasemapFailure, retireTilesNotice,
    styleLoaded: () => listeners.get("style.load")!(),
    fail(id: string) {
      states.set(id, "errored");
      listeners.get("error")!(tileEvent(id));
    },
    load(id: string) {
      states.set(id, "loaded");
      listeners.get("sourcedata")!(tileEvent(id));
    },
    render: () => listeners.get("render")!(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("component basemap recovery with MapLibre settled errors", () => {
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
