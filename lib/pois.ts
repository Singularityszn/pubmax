// Ambient points-of-interest layer for the map: tube stations, green spaces, and
// tourist sights. Static and bundled (public/data/london_pois.json) — the app is
// deliberately keyless/offline, so there are no runtime external API calls here.
//
// This is a SEPARATE, lighter layer from lib/landmarks.ts: POIs carry no history
// text and no sources. They are ambient orientation dots that complement the
// sourced heritage landmarks, not duplicates of them.

export type PoiCategory = "tube" | "park" | "sight";

export type Poi = {
  id: string;
  name: string;
  category: PoiCategory;
  /** [lng, lat] — same convention as lib/landmarks.ts. */
  coordinates: [number, number];
};

const POI_CATEGORIES: readonly PoiCategory[] = ["tube", "park", "sight"];

// Advisory display metadata the map canvas (WS-D) consumes. Colours reuse the
// app's brass/river/pint token hexes from app/globals.css where sensible; the
// canvas decides final rendering, so treat glyph/colour as typed hints.
export const POI_CATEGORY_META: Record<
  PoiCategory,
  { label: string; color: string; glyph: string }
> = {
  // Roundel-ish: TfL red bar over a river-blue ring reads as a station marker.
  tube: { label: "Station", color: "#e01e2b", glyph: "Ⓤ" },
  // Green space → the "cheap pint / positive" pint token.
  park: { label: "Green space", color: "#2f8f5b", glyph: "🌳" },
  // Tourist sight → the guidebook brass accent.
  sight: { label: "Sight", color: "#9a6a24", glyph: "★" },
};

function isPoiCategory(value: unknown): value is PoiCategory {
  return typeof value === "string" && (POI_CATEGORIES as readonly string[]).includes(value);
}

// Light runtime guard: hand-authored JSON can drift, so drop malformed rows
// rather than letting a bad coordinate poison the map layer.
function isValidPoi(value: unknown): value is Poi {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) return false;
  if (typeof row.name !== "string" || row.name.length === 0) return false;
  if (!isPoiCategory(row.category)) return false;
  const coords = row.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return false;
  const [lng, lat] = coords;
  return (
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    typeof lat === "number" &&
    Number.isFinite(lat)
  );
}

/**
 * Fetches the bundled POI dataset (client-side), mirroring PubMap.tsx's fetch of
 * the pint dataset. Malformed rows are filtered out so callers always get a
 * clean Poi[].
 */
export async function loadPois(): Promise<Poi[]> {
  const response = await fetch("/data/london_pois.json");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) return [];
  return data.filter(isValidPoi);
}
