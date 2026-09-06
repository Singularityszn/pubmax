"use client";

import { loadSurfaceJson } from "@/lib/surfaceDataCache";

// One CityMCP place search, shared by every venue-sheet surface that needs it.
//
// `CityPlaceStrip` and `VenueBuzz` both mount on a venue sheet and both asked
// `/api/citymcp/places` for the SAME pub, with a byte-identical URL, through
// their own copy of this function. Measured on `/map?sel=`, that was two
// `no-store` requests and two function invocations for one question. The copies
// were also two places to fix a parsing bug, and the fix would have landed in
// one of them.
//
// The read goes through `loadSurfaceJson`, so two surfaces asking together join
// ONE request and a return to the sheet paints from the held answer. Nothing
// about the question is per-viewer: it is a pub's public name and borough.

/** A candidate CityMCP place, narrowed to what a caller can match against. */
export type CityPlaceCandidate = {
  id: string;
  location?: { lat: number; lng: number };
};

type PlacesBody = {
  places?: Array<{ id?: string; location?: { lat?: number; lng?: number } }>;
};

/** The request both surfaces make. Shared so the answer is keyed by one URL. */
export function cityPlaceSearchUrl(name: string, borough: string | undefined): string {
  const params = new URLSearchParams();
  params.set("q", borough ? `${name} ${borough}` : name);
  params.set("limit", "5");
  return `/api/citymcp/places?${params.toString()}`;
}

function toCandidates(body: PlacesBody): CityPlaceCandidate[] {
  if (!Array.isArray(body.places)) return [];
  return body.places
    .filter(
      (place): place is { id: string; location?: { lat: number; lng: number } } =>
        typeof place?.id === "string" && place.id.length > 0,
    )
    .map((place) => ({
      id: place.id,
      location:
        place.location &&
        typeof place.location.lat === "number" &&
        typeof place.location.lng === "number"
          ? { lat: place.location.lat, lng: place.location.lng }
          : undefined,
    }));
}

/**
 * Candidate places for one pub name. Never throws: a failed or unreadable read
 * answers an empty list, which every caller already treats as "no match".
 */
export async function searchCityPlacesByName(
  name: string,
  borough: string | undefined,
  signal: AbortSignal,
): Promise<CityPlaceCandidate[]> {
  let candidates: CityPlaceCandidate[] = [];
  await loadSurfaceJson<PlacesBody>(
    cityPlaceSearchUrl(name, borough),
    {
      signal,
      init: { headers: { accept: "application/json" } },
      validate: (body) => Array.isArray(body?.places),
    },
    (body) => {
      candidates = toCandidates(body);
    },
  );
  return candidates;
}
