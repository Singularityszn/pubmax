import type maplibregl from "maplibre-gl";
import { iconId } from "@/lib/mapIcons";
import { offsetIndexForLine } from "@/lib/tubeOffsets";
import { TRANSPORT_CATEGORIES, type PoiCategory } from "@/lib/pois";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";

// Ambient categories render as soft coloured dots; transport (TRANSPORT_CATEGORIES)
// render as their real TfL / National Rail symbol on separate layers.
export const AMBIENT_CATEGORIES: readonly PoiCategory[] = [
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
];

// A MapLibre filter keeping only the not-hidden categories within a given group
// (the transport symbols and the ambient dots live on different layers).
export function poiFilter(
  hidden: Record<PoiCategory, boolean>,
  group: readonly PoiCategory[],
): maplibregl.FilterSpecification {
  const visible = group.filter((category) => !hidden[category]);
  return ["in", ["get", "category"], ["literal", visible]];
}

// Transport filter, split by rank so majors (the skeleton) and minors (revealed
// deeper) can sit on separate zoom-gated layers while both honour the toggles.
export function transportFilter(
  hidden: Record<PoiCategory, boolean>,
  majorOnly: boolean,
): maplibregl.FilterSpecification {
  const visible = TRANSPORT_CATEGORIES.filter((category) => !hidden[category]);
  const inCategory: maplibregl.ExpressionSpecification = [
    "in",
    ["get", "category"],
    ["literal", visible],
  ];
  const rankTest: maplibregl.ExpressionSpecification = majorOnly
    ? ["==", ["coalesce", ["get", "rank"], 2], 1]
    : ["!=", ["coalesce", ["get", "rank"], 2], 1];
  return ["all", inCategory, rankTest];
}

// icon-image match for a transport feature → its TfL symbol id (lib/mapIcons).
export const TRANSPORT_ICON_MATCH: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "category"],
  "tube",
  iconId("tfl", "underground"),
  "rail",
  iconId("tfl", "rail"),
  "bus",
  iconId("tfl", "bus"),
  "river",
  iconId("tfl", "river"),
  iconId("tfl", "underground"),
];
export const TONIGHT_OPPORTUNITY_LAYERS = [
  "tonight-halo",
  "tonight-point",
  "tonight-label",
] as const;

function normaliseFeatureString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function opportunityForFeature(
  props: GeoJSON.GeoJsonProperties | undefined,
  opportunities: readonly ThingsToDoOpportunity[],
): ThingsToDoOpportunity | undefined {
  const title = normaliseFeatureString(props?.title);
  const placeName = normaliseFeatureString(props?.placeName);
  return opportunities.find((op) => {
    const opTitle = normaliseFeatureString(op.title);
    const opPlaceName = normaliseFeatureString(op.place?.name);
    if (title && placeName) return opTitle === title && opPlaceName === placeName;
    if (title) return opTitle === title;
    return Boolean(placeName && opPlaceName === placeName);
  });
}

// Issue #16 — parallel coloured tube lines. The known sub-surface fan lines
// (Metropolitan / Circle / H&C / District) run four-abreast through shared
// central corridors; we fan them apart with a per-line `line-offset` so they
// read side-by-side like the real tube map instead of one overlapping stroke.
//
// Offset math: offsetIndexForLine(line) gives a symmetric index (…-1.5, -0.5,
// 0.5, 1.5) for the fan lines and 0 for everything else. We turn that index into
// a MapLibre `match` expression, then multiply by a zoom-scaled pixel step so
// the lines CONVERGE at low zoom (network reads as one line) and FAN OUT from
// ~zoom 12 (the corridor separates). Documented ceiling: the source geometry is
// per-line from independent OSM ways and rarely shares vertices, so we offset
// the whole line by its fan index rather than per-shared-segment — the accepted
// ceiling in issue #16.
const FAN_LINES = ["Metropolitan", "Circle", "Hammersmith & City", "District"] as const;

// A `["match", ["get","line"], name, index, …, 0]` expression: each fan line to
// its offset index, all others to 0. Built once (module const) from the pure
// offsetIndexForLine so the map and the unit-tested logic never drift.
const TUBE_OFFSET_INDEX_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "line"],
  ...FAN_LINES.flatMap((line) => [line, offsetIndexForLine(line)] as [string, number]).flat(),
  0,
] as unknown as maplibregl.ExpressionSpecification;

// The signed pixel offset for a line at the current zoom: offsetIndex × a
// zoom-interpolated per-index step. At/below zoom 11 the step is 0 (lines
// converge); it grows to a full fan by zoom 14. `line-offset` is in pixels and
// perpendicular to the line, so a symmetric index set fans the group evenly.
export const TUBE_LINE_OFFSET_EXPR: maplibregl.ExpressionSpecification = [
  "*",
  TUBE_OFFSET_INDEX_EXPR,
  ["interpolate", ["linear"], ["zoom"], 11, 0, 12, 1.4, 14, 3.2, 16, 4.5],
] as unknown as maplibregl.ExpressionSpecification;
