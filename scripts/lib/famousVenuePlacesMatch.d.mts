export function normalizeVenueName(name: string): string;

export function evaluateNameMatch(
  venueName: string,
  displayName: string | { text?: string },
  aliases?: readonly string[],
): { match: boolean; reason: string };

export function evaluateLocationMatch(
  row: {
    address: string;
    lat?: number;
    lng?: number;
    location?: { lat: number; lng: number };
  },
  place: {
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
  },
): { match: boolean; reason: string };

export function decidePlacesVerification(
  row: {
    id: string;
    name: string;
    address: string;
    lat?: number;
    lng?: number;
    placesNameAliases?: readonly string[];
  },
  places: unknown[],
): {
  outcome: "confirmed" | "closed" | "unverified";
  result: string;
  evidence: { placeId?: string | null; matchReason: string };
};

export function placesTextQueryForRow(row: {
  name: string;
  address: string;
  borough?: string;
}): string;
