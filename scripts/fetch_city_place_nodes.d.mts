export interface PlaceNodeCity {
  id: string;
  name: string;
}

export interface PlaceNode {
  cityId: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
}

export const PLACE_NODE_CITIES: readonly PlaceNodeCity[];
export const PLACE_KINDS: readonly string[];
export const CENTRE_PLACE_KIND: string;

export function buildPlaceQuery(bounds: {
  latMin: number;
  lonMin: number;
  latMax: number;
  lonMax: number;
}): string;

export function normalisePlaceElements(
  elements: unknown[] | undefined,
  city: PlaceNodeCity,
): { places: PlaceNode[]; dropped: number };
