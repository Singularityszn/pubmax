import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tameNumericShieldFilters } from "@/lib/mapBasemapTaste";
import * as tilePolicy from "@/lib/mapTileFailure";
import { STYLE_LOAD_TIMEOUT_MS } from "@/components/map/canvas/tokens";
import { BASEMAP_RETRY_NOTICE } from "@/components/map/canvas/pinRevealCoordinator";

// Execute installed MapLibre's replacement logic. Stub Style IO only: no network,
// workers, or renderer. A failed/held Style must not need style.load to retire.
function installedMap() {
  const path = "node_modules/maplibre-gl/src/ui/map.ts";
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const methods: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && ["setStyle", "_updateStyle"].includes(node.name.getText(source))) {
      methods.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(methods).toHaveLength(2);
  const loads: Array<{ url: string; options: { transformStyle: typeof tameNumericShieldFilters } }> = [];
  class StyleIO {
    _loaded = false;
    once = vi.fn();
    setEventedParent = vi.fn();
    _remove = vi.fn();
    serialize = vi.fn(() => ({ version: 8, sources: {}, layers: [] }));
    loadURL(url: string, options: { transformStyle: typeof tameNumericShieldFilters }) {
      loads.push({ url, options });
    }
  }
  const emitted = ts.transpileModule(`return class { ${methods.join("\n")} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Constructor = new Function("Style", "extend", emitted)(StyleIO, Object.assign) as new () => {
    style?: StyleIO;
    setStyle(style: string | null, options?: unknown): void;
  };
  return { map: new Constructor(), loads };
}

// Use the component's actual local loader, including its queue and supersede branch.
function protectedLoader(map: ReturnType<typeof installedMap>["map"]) {
  const source = readFileSync("components/PubMapCanvas.tsx", "utf8");
  const localLoader = source.slice(source.indexOf("let protectedStyleInFlight = false;"), source.indexOf("function swapToBasemapFallback()"));
  expect(localLoader).toContain("function setProtectedStyle(");
  const emitted = ts.transpileModule(`
    let usingFallback = false;
    const styleStructureReadyRef = { current: false };
    const mapRef = { current: map };
    const armStyleLoadProtection = () => {};
    const surfaceBasemapFailure = (detail) => { throw new Error(detail); };
    const swapToBasemapFallback = () => { throw new Error("Unexpected synchronous style error"); };
    ${localLoader}
    return setProtectedStyle;
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("map", "tameNumericShieldFilters", emitted)(map, tameNumericShieldFilters) as (
    url: string, fallback: boolean, supersede?: boolean,
  ) => void;
}

describe("protected style replacement against installed MapLibre", () => {
  it("starts fallback when a failed or held initial style never loads", () => {
    const { map, loads } = installedMap();
    const load = protectedLoader(map);
    load("https://openfreemap.invalid/style.json", false);
    const pending = map.style!;
    expect(pending._loaded).toBe(false);
    // Neither failure nor a held response emits style.load.
    load("https://carto.invalid/style.json", true, true);
    expect(loads.map(({ url }) => url)).toEqual([
      "https://openfreemap.invalid/style.json", "https://carto.invalid/style.json",
    ]);
    expect(pending._remove).toHaveBeenCalledWith(true);
    expect(pending.once).not.toHaveBeenCalled();
    expect(map.style).not.toBe(pending);
    expect(loads[1].options.transformStyle).toBeTypeOf("function");
  });

  it("keeps a loaded style available for an ordinary theme transform", () => {
    const { map, loads } = installedMap();
    map.setStyle("https://openfreemap.invalid/style.json", { diff: false });
    const loaded = map.style!;
    loaded._loaded = true;
    protectedLoader(map)("https://openfreemap.invalid/dark.json", false);
    expect(loads).toHaveLength(2);
    expect(loaded.serialize).toHaveBeenCalledOnce();
    expect(loaded._remove).toHaveBeenCalledWith(false);
    expect(loaded.once).not.toHaveBeenCalled();
  });
});

// Keep style loading, fallback timers, and final surface selection in one caller.
// The renderer and network stay outside this boundary; installed setStyle runs.
function styleFailureCaller() {
  const { map, loads } = installedMap();
  const source = readFileSync("components/PubMapCanvas.tsx", "utf8");
  const block = (start: string, end: string) => {
    const from = source.indexOf(start);
    const until = source.indexOf(end, from);
    if (from < 0 || until < 0) throw new Error(`Missing style caller: ${start}`);
    return source.slice(from, until);
  };
  const listeners = new Map<string, Array<(event?: unknown) => void>>();
  const emit = (event: string) => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  Object.assign(map, {
    on(event: string, listener: (event?: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  });
  const setSoftRetry = vi.fn();
  const reportMapError = vi.fn();
  const { areBasemapTilesLoaded: readBasemapTilesLoaded, ...tileImports } = tilePolicy;
  const scope = {
    ...tileImports, readBasemapTilesLoaded, map, tameNumericShieldFilters, setSoftRetry, reportMapError,
    MAP_STYLES: { light: "https://primary.invalid/style.json" },
    FALLBACK_STYLES: { light: "https://fallback.invalid/style.json" },
    BASEMAP_RETRY_NOTICE, STYLE_LOAD_TIMEOUT_MS,
    themeRef: { current: "light" },
    pinRevealCoordinator: { cancel: vi.fn() },
    cancelDeferredWork: vi.fn(), buildScene: vi.fn(),
  };
  const emitted = ts.transpileModule(`
    const mapRef = { current: map };
    const styleStructureReadyRef = { current: false };
    const hangFailTimer = undefined;
    let styleGeneration = 0;
    ${block("let styleLoaded = false;", "// --- M7 pin entrance.")}
    ${block("const areBasemapTilesLoaded =", "// The silent lane:")}
    ${block("const surfaceBasemapFailure =", "// ONE recovery budget per mount")}
    ${block('map.on("error", (event) => {', "// --- Post-init context loss")}
    return {
      replace: () => setProtectedStyle(MAP_STYLES.light, false),
      dispose: () => { clearStyleLoadProtection(); clearTimeout(hangFailTimer); },
      timeout: STYLE_LOAD_TIMEOUT_MS,
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const caller = new Function(...Object.keys(scope), emitted)(...Object.values(scope)) as {
    replace: () => void; dispose: () => void; timeout: number;
  };
  return {
    ...caller, loads, setSoftRetry, reportMapError,
    loaded: () => { map.style!._loaded = true; emit("style.load"); },
    failed: () => emit("error"),
  };
}

describe("style failure surface through the actual replacement caller", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("keeps Retry soft when both replacement styles fail after a successful style", async () => {
    const caller = styleFailureCaller();
    caller.loaded();
    caller.replace();
    caller.failed();
    caller.failed();
    await vi.advanceTimersByTimeAsync(caller.timeout);
    expect(caller.setSoftRetry).toHaveBeenCalledOnce();
    expect(caller.reportMapError).not.toHaveBeenCalled();
    expect(caller.loads.map(({ url }) => url)).toEqual([
      "https://primary.invalid/style.json", "https://primary.invalid/style.json",
      "https://fallback.invalid/style.json",
    ]);
    await vi.advanceTimersByTimeAsync(caller.timeout * 2);
    expect(caller.loads).toHaveLength(3);
    expect(caller.setSoftRetry).toHaveBeenCalledOnce();
  });

  it("keeps the full card when neither initial style ever loads", async () => {
    const caller = styleFailureCaller();
    caller.failed();
    caller.failed();
    await vi.advanceTimersByTimeAsync(caller.timeout);
    expect(caller.setSoftRetry).not.toHaveBeenCalled();
    expect(caller.reportMapError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "tiles", detail: "Fallback style reload failed",
    }));
    expect(caller.loads).toHaveLength(2);
  });

  it("remembers a successful fallback across a later failed replacement", async () => {
    const caller = styleFailureCaller();
    caller.failed();
    caller.loaded();
    caller.replace();
    caller.failed();
    caller.failed();
    await vi.advanceTimersByTimeAsync(caller.timeout);
    expect(caller.setSoftRetry).toHaveBeenCalledOnce();
    expect(caller.reportMapError).not.toHaveBeenCalled();
  });

  it("clears protection when a replacement loads successfully", async () => {
    const caller = styleFailureCaller();
    caller.loaded();
    caller.replace();
    caller.loaded();
    await vi.advanceTimersByTimeAsync(caller.timeout * 3);
    expect(caller.loads).toHaveLength(2);
    expect(caller.setSoftRetry).not.toHaveBeenCalled();
    expect(caller.reportMapError).not.toHaveBeenCalled();
  });

  it("does not carry a successful style into a fresh map mount", async () => {
    const previous = styleFailureCaller();
    previous.loaded();
    previous.dispose();
    const fresh = styleFailureCaller();
    fresh.failed();
    fresh.failed();
    await vi.advanceTimersByTimeAsync(fresh.timeout);
    expect(fresh.reportMapError).toHaveBeenCalledOnce();
    expect(fresh.setSoftRetry).not.toHaveBeenCalled();
    expect(previous.setSoftRetry).not.toHaveBeenCalled();
  });
});
