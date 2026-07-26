export interface OsmPub {
  osmId: string;
  name: string;
  amenity: string | null;
  lat: number;
  lng: number;
  address: string | null;
  postcode: string | null;
  website: string | null;
  phone: string | null;
  openingHours: string | null;
  brewery: string | null;
  operator: string | null;
  outdoorSeating: boolean;
  smoking: Record<string, string> | null;
  cuisine: string | null;
  wikidata: string | null;
  wikipedia: string | null;
}

export function normalizeOsmPubElement(
  element: unknown,
  options?: { fallbackCity?: string | null },
): OsmPub | null;

export function sortOsmPubs<T extends OsmPub>(pubs: T[]): T[];
