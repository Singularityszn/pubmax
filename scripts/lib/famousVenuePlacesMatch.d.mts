export function normalizeVenueName(name: string): string;

export function evaluateNameMatch(
  venueName: string,
  displayName: string | { text?: string },
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
  row: { id: string; name: string; address: string; lat?: number; lng?: number },
  places: unknown[],
): {
  outcome: "confirmed" | "closed" | "unverified";
  result: string;
  evidence?: Record<string, unknown>;
};

export function placesTextQueryForRow(row: {
  name: string;
  address: string;
  borough?: string;
}): string;
