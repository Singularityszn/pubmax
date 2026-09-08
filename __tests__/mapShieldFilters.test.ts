import { readFileSync } from "node:fs";
import { featureFilter, type FilterSpecification, type StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { tameNumericShieldFilters } from "@/lib/mapBasemapTaste";

// Exact filters from the retained console-health trace's OpenFreeMap positron response.
const shields: Array<{ id: string; filter: Exclude<FilterSpecification, boolean>; network: string; excluded: string }> = [
  {
    id: "highway-shield-non-us",
    filter: ["all", ["<=", ["get", "ref_length"], 6],
      ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
      ["match", ["get", "network"], ["us-highway", "us-interstate", "us-state"], false, true]],
    network: "gb-motorway",
    excluded: "us-highway",
  },
  {
    id: "highway-shield-us-interstate",
    filter: ["all", ["<=", ["get", "ref_length"], 6],
      ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
      ["match", ["get", "network"], ["us-interstate"], true, false]],
    network: "us-interstate",
    excluded: "us-state",
  },
  {
    id: "road_shield_us",
    filter: ["all", ["<=", ["get", "ref_length"], 6],
      ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
      ["match", ["get", "network"], ["us-highway", "us-state"], true, false]],
    network: "us-state",
    excluded: "us-interstate",
  },
];

function styleFor(id: string, filter: FilterSpecification): StyleSpecification {
  return {
    version: 8,
    sources: { openmaptiles: { type: "vector", tiles: ["https://example.invalid/{z}/{x}/{y}.pbf"] } },
    layers: [{ id, type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", filter }],
  };
}

describe.each(shields)("$id numeric filter", ({ id, filter, network, excluded }) => {
  it("preserves other clauses, leaves the input intact, and is idempotent", () => {
    const original = styleFor(id, structuredClone(filter));
    const before = structuredClone(original);
    const guarded = tameNumericShieldFilters(original);
    expect(original).toEqual(before);
    expect(guarded.layers[0]).toEqual({
      ...original.layers[0],
      filter: ["all", ["<=", ["number", ["get", "ref_length"], 0], 6], ...filter.slice(2)],
    });
    expect(tameNumericShieldFilters(guarded)).toEqual(guarded);
    expect(guarded.sources).toBe(original.sources);
  });

  it("evaluates missing lengths without warnings and keeps geometry/network restrictions", () => {
    const layer = tameNumericShieldFilters(styleFor(id, filter)).layers[0];
    if (!("filter" in layer)) throw new Error("Expected a symbol filter.");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const compiled = featureFilter(layer.filter, `layers[${id}].filter`);
      for (const ref_length of [undefined, null, "invalid", 0, 6]) {
        const properties = { network, ...(ref_length === undefined ? {} : { ref_length }) };
        expect(compiled.filter({ zoom: 12 }, { type: 2, properties })).toBe(true);
      }
      expect(compiled.filter({ zoom: 12 }, { type: 2, properties: { network, ref_length: 7 } })).toBe(false);
      expect(compiled.filter({ zoom: 12 }, { type: 1, properties: { network } })).toBe(false);
      expect(compiled.filter({ zoom: 12 }, { type: 2, properties: { network: excluded } })).toBe(false);
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});

it("leaves other style layers and styles without shield filters unchanged", () => {
  const unrelated = styleFor("unrelated-label", shields[0].filter);
  const background = { id: "background", type: "background" } as const;
  unrelated.layers.push(background);
  const normalized = tameNumericShieldFilters(unrelated);
  expect(normalized).toEqual(unrelated);
  expect(normalized.layers[0]).toBe(unrelated.layers[0]);
  expect(normalized.layers[1]).toBe(background);
  expect(tameNumericShieldFilters({ version: 8, sources: {}, layers: [] })).toEqual({ version: 8, sources: {}, layers: [] });
});

it("loads initial and replacement styles through the protected pre-compilation transform", () => {
  const code = readFileSync("components/PubMapCanvas.tsx", "utf8");
  const source = ts.createSourceFile("PubMapCanvas.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const constructors: ts.NewExpression[] = [];
  const replacements: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && node.expression.getText(source) === "maplibregl.Map") constructors.push(node);
    if (ts.isCallExpression(node) && node.expression.getText(source) === "map.setStyle") replacements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(constructors).toHaveLength(1);
  const options = constructors[0].arguments?.[0];
  if (!options || !ts.isObjectLiteralExpression(options)) throw new Error("Expected map options.");
  expect(options.properties.some((property) => property.name?.getText(source) === "style")).toBe(false);
  const loads = replacements.filter((call) => call.arguments[0].kind !== ts.SyntaxKind.NullKeyword);
  expect(loads).toHaveLength(1);
  expect(loads[0].arguments[1].getText(source)).toContain("transformStyle: (_previousStyle, nextStyle) => tameNumericShieldFilters(nextStyle)");
  expect(code).toContain("setProtectedStyle(MAP_STYLES[themeRef.current], false)");
  expect(code).toContain("setProtectedStyle(MAP_STYLES[next], false)");
  expect(code).toContain("setProtectedStyle(FALLBACK_STYLES[themeRef.current], true, true)");
});
