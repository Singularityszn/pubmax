import { haversineKm } from "@/lib/haversine";
import type { NightAreaSlug } from "@/lib/nightAreaSlugs";

// One Night Area can hold two places that people name apart. A focus narrows
// a Plan to the place the reader named, and the Plan context keeps it through
// lock and regeneration. The area slug stays the same everywhere else.

const NIGHT_AREA_FOCI = ["soho", "piccadilly"] as const;
export type NightAreaFocus = (typeof NIGHT_AREA_FOCI)[number];

type LngLat = readonly [number, number];
type FocusShape =
  | { kind: "polygon"; ring: readonly LngLat[] }
  | { kind: "circle"; radiusKm: number };

type FocusDefinition = {
  area: NightAreaSlug;
  label: string;
  word: RegExp;
  centre: { lat: number; lng: number };
  shape: FocusShape;
};

const FOCI: Record<NightAreaFocus, FocusDefinition> = {
  // Oxford Street, Charing Cross Road, Shaftesbury Avenue and Regent Street.
  soho: {
    area: "piccadilly-soho",
    label: "Soho",
    word: /\bsoho\b/i,
    centre: { lat: 51.5136, lng: -0.1338 },
    shape: { kind: "polygon", ring: [[-0.1418, 51.5154], [-0.1301, 51.5161], [-0.1286, 51.5133], [-0.134, 51.5101], [-0.1378, 51.5106]] },
  },
  // A short walk from Piccadilly Circus.
  piccadilly: {
    area: "piccadilly-soho",
    label: "Piccadilly",
    word: /\bpiccadilly\b/i,
    centre: { lat: 51.5101, lng: -0.1342 },
    shape: { kind: "circle", radiusKm: 0.6 },
  },
};

export function isNightAreaFocus(value: unknown): value is NightAreaFocus {
  return typeof value === "string" && (NIGHT_AREA_FOCI as readonly string[]).includes(value);
}

/** A focus is valid only inside the Night Area that holds it. */
export function focusForArea(area: NightAreaSlug | null | undefined, focus: unknown): NightAreaFocus | null {
  return isNightAreaFocus(focus) && FOCI[focus].area === area ? focus : null;
}

/**
 * The focus that a query names for `area`. A query that names both places, or
 * neither, asks for the whole area.
 */
export function nightAreaFocusFromQuery(area: NightAreaSlug | null, query: string): NightAreaFocus | null {
  const named = NIGHT_AREA_FOCI.filter((focus) => FOCI[focus].area === area && FOCI[focus].word.test(query));
  return named.length === 1 ? named[0]! : null;
}

export function nightAreaFocusCentre(focus: NightAreaFocus): { lat: number; lng: number } {
  return FOCI[focus].centre;
}

export function nightAreaFocusLabel(focus: NightAreaFocus): string {
  return FOCI[focus].label;
}

function ringContains(ring: readonly LngLat[], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function nightAreaFocusContains(focus: NightAreaFocus, point: { lat: number; lng: number }): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  const { shape, centre } = FOCI[focus];
  return shape.kind === "polygon"
    ? ringContains(shape.ring, point.lng, point.lat)
    : haversineKm([centre.lng, centre.lat], [point.lng, point.lat]) <= shape.radiusKm;
}

/** The place name a Plan shows: the focus when one is set, otherwise the area. */
export function planAreaName(areaName: string, focus: NightAreaFocus | null | undefined): string {
  return focus ? FOCI[focus].label : areaName;
}
