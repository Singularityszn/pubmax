import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const component = readFileSync("components/PubMapCanvas.tsx", "utf8");
function callerBlock(start: string, end: string): string {
  const from = component.indexOf(start);
  const until = component.indexOf(end, from);
  if (from < 0 || until < 0) throw new Error(`Missing caller block: ${start}`);
  return component.slice(from, until);
}

// Retain MapLibre's actual loss, restoration, and deferred JSON load. Only
// renderer, network, and worker IO are replaced for this one-worker proof.
function installedMethods(path: string, names: string[]): string {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const members: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && names.includes(node.name.getText(source))) {
      members.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (members.length !== names.length) throw new Error(`Missing installed methods: ${names.join(", ")}`);
  return members.join("\n");
}

function contextCaller() {
  const handlers = new Map<string, Set<(event: Event) => void>>();
  const appFrames: FrameRequestCallback[] = [];
  const styleFrames: Array<() => void> = [];
  const lifecycle: string[] = [];
  const body = vi.fn();
  const settleSceneError = vi.fn();
  const containerRef = { current: { dataset: { webglRecovery: "listening" } } };
  const mapMethods = installedMethods("node_modules/maplibre-gl/src/ui/map.ts", ["_contextLost", "_contextRestored", "_getStyleAndImages"]);
  const styleMethods = installedMethods("node_modules/maplibre-gl/src/style/style.ts", ["loadJSON", "_checkLoaded"]);
  const emittedEngine = ts.transpileModule(`
    class StyleIO {
      _loaded = true;
      _layers = {};
      imageManager = { images: {}, cloneImages: () => ({}) };
      map;
      constructor(map) { this.map = map; }
      serialize() { return { version: 8, sources: {}, layers: [] }; }
      destroy() { lifecycle.push("style-destroyed"); }
      fire() {}
      _load() { this._loaded = true; lifecycle.push("style-loaded"); this.map.fire({ type: "style.load" }); }
      ${styleMethods}
    }
    return class {
      style = new StyleIO(this);
      painter = { destroy: () => lifecycle.push("painter-destroyed") };
      _setupPainter() {}
      _update() {}
      _resizeInternal() {}
      resize() {}
      triggerRepaint() {}
      getCanvas() { return { addEventListener() {} }; }
      on(name, handler) {
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name).add(handler);
      }
      off(name, handler) { handlers.get(name)?.delete(handler); }
      fire(event) {
        lifecycle.push(event.type + ":" + (this.style === null ? "null" : this.style._loaded));
        for (const handler of [...(handlers.get(event.type) ?? [])]) handler(event);
      }
      setStyle(json) { this.style = new StyleIO(this); this.style._loaded = false; this.style.loadJSON(json); }
      ${mapMethods}
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Constructor = new Function("browser", "MapContextEvent", "MapStyleDataEvent", "lifecycle", "handlers", emittedEngine)(
    { frameAsync: () => new Promise<void>(resolve => styleFrames.push(resolve)) },
    class { constructor(public type: string) {} },
    class { constructor(public type: string) {} },
    lifecycle, handlers,
  ) as new () => {
    style: { _loaded: boolean; _checkLoaded: () => void } | null;
    fire: (event: { type: string }) => void;
    _contextLost: (event: Event) => void;
    _contextRestored: (event: Event) => void;
  };
  const map = new Constructor();
  const scope = {
    map, mapRef: { current: map }, containerRef,
    markPubmaxTiming: vi.fn(), cancelDeferredWork: vi.fn(),
    pinRevealCoordinator: { cancel: vi.fn() },
    beginTileFailureGeneration: vi.fn(),
    buildSceneBody: () => { map.style!._checkLoaded(); body(); },
    settleSceneReady: vi.fn(), settleSceneError,
    scheduleContextRecovery: vi.fn(),
    setProtectedStyle: vi.fn(),
    requestAnimationFrame: (callback: FrameRequestCallback) => appFrames.push(callback),
    window: { setTimeout, clearTimeout },
  };
  const emittedCaller = ts.transpileModule(`
    let styleGeneration = 0, styleLoaded = false, initialBasemapPending = true;
    let contextRecoveryTimer, contextLostTimer;
    let protectedStyleInFlight = false, queuedProtectedStyle = null;
    const clearStyleLoadProtection = () => {};
    const styleStructureReadyRef = { current: false };
    ${callerBlock("const buildScene =", "const buildSceneBody =")}
    ${callerBlock('map.on("style.load", () => {', '// Initial load shares theme/fallback')}
    ${callerBlock("const canvasEl = map.getCanvas();", 'if (containerRef.current) {\n      containerRef.current.dataset.webglRecovery = "listening";')}
    return { onCanvasContextLost, onCanvasContextRestored };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const caller = new Function(...Object.keys(scope), emittedCaller)(...Object.values(scope)) as {
    onCanvasContextLost: (event: Event) => void;
    onCanvasContextRestored: () => void;
  };
  return {
    body, settleSceneError, lifecycle, containerRef,
    beginScene() { map.fire({ type: "style.load" }); map.fire({ type: "render" }); },
    drainAppFrames() { for (const callback of appFrames.splice(0)) callback(0); },
    loseAndRestore() {
      const event = new Event("webglcontextlost", { cancelable: true });
      map._contextLost(event);
      expect(map.style).toBeNull();
      caller.onCanvasContextLost(event);
      map._contextRestored(new Event("webglcontextrestored"));
      caller.onCanvasContextRestored();
      expect(map.style?._loaded).toBe(false);
    },
    async finishRestore() {
      for (const resolve of styleFrames.splice(0)) resolve();
      await Promise.resolve();
      map.fire({ type: "render" });
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("component scene work across installed MapLibre context restoration", () => {
  it("rejects a pending old scene while the restored style is still loading", async () => {
    const caller = contextCaller();
    caller.beginScene();
    caller.loseAndRestore();
    caller.drainAppFrames();
    expect(caller.settleSceneError).not.toHaveBeenCalled();
    expect(caller.body).not.toHaveBeenCalled();
    await caller.finishRestore();
    caller.drainAppFrames();
    expect(caller.body).toHaveBeenCalledOnce();
    expect(caller.containerRef.current.dataset.webglRecovery).toBe("restored");
    expect(caller.lifecycle).toContain("webglcontextlost:null");
    expect(caller.lifecycle).toContain("webglcontextrestored:false");
  });

  it("rebuilds a steady scene after the restored engine style loads", async () => {
    const caller = contextCaller();
    caller.beginScene();
    caller.drainAppFrames();
    expect(caller.body).toHaveBeenCalledOnce();
    caller.loseAndRestore();
    await caller.finishRestore();
    caller.drainAppFrames();
    expect(caller.body).toHaveBeenCalledTimes(2);
    expect(caller.settleSceneError).not.toHaveBeenCalled();
  });
});
