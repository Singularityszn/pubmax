import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { tameNumericShieldFilters } from "@/lib/mapBasemapTaste";

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
