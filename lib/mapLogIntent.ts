import { haversineKm } from "@/lib/haversine";

type ResolveMapLogIntentInput = {
  hasLogIntent: boolean;
  loaded: boolean;
  selectedVenueId: string;
  selectedVenueResolvable: boolean;
  selectedVenueIsPub: boolean;
  firstRouteId: string;
  firstFilteredVenueId: string;
};

export type MapLogIntentResolution =
  | { status: "inactive" }
  | { status: "pending" }
  | { status: "open"; venueId: string }
  | { status: "fallback" };

export type LogNearbyCandidate = {
  id: string;
  name: string;
  priceLabel: string;
  /** Straight-line km from origin when geo-sorted; omitted without a fix. */
  distanceKm?: number;
};

// Cap the nearby-picker list so the log-intent fallback stays thumb-scannable.
export const LOG_NEARBY_PICKER_LIMIT = 5;

type LogNearbyVenue = {
  id: string;
  name: string;
  cheapestPrice?: number | null;
  latitude?: number;
  longitude?: number;
};

type LogNearbyOrigin = { lat: number; lng: number };

function priceLabelFor(venue: LogNearbyVenue): string {
  return typeof venue.cheapestPrice === "number" && Number.isFinite(venue.cheapestPrice)
    ? `£${venue.cheapestPrice.toFixed(2)}`
    : "Price TBD";
}

/**
 * Wave K0 — Drop nearby picker.
 * With a GPS origin, sort by haversine nearest-first (venues missing coords sink).
 * Without origin, preserve list order (filtered map order).
 */
export function buildLogNearbyCandidates(
  venues: LogNearbyVenue[],
  limit = LOG_NEARBY_PICKER_LIMIT,
  origin?: LogNearbyOrigin | null,
): LogNearbyCandidate[] {
  const take = Math.max(0, Math.min(Math.floor(limit), venues.length));
  if (take === 0) return [];

  const ranked = origin
    ? [...venues]
        .map((venue) => {
          const hasCoords =
            typeof venue.latitude === "number" &&
            Number.isFinite(venue.latitude) &&
            typeof venue.longitude === "number" &&
            Number.isFinite(venue.longitude);
          const distanceKm = hasCoords
            ? haversineKm([origin.lng, origin.lat], [venue.longitude!, venue.latitude!])
            : Number.POSITIVE_INFINITY;
          return { venue, distanceKm };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm)
    : venues.map((venue) => ({ venue, distanceKm: undefined as number | undefined }));

  return ranked.slice(0, take).map(({ venue, distanceKm }) => ({
    id: venue.id,
    name: venue.name,
    priceLabel: priceLabelFor(venue),
    ...(typeof distanceKm === "number" && Number.isFinite(distanceKm)
      ? { distanceKm }
      : {}),
  }));
}

type QueryLike = string | { get(name: string): string | null };

export function hasMapLogIntent(query: QueryLike): boolean {
  if (typeof query !== "string") return query.get("log") === "1";
  const normalized = query.startsWith("?") ? query.slice(1) : query;
  return new URLSearchParams(normalized).get("log") === "1";
}

export function shouldRunMapLogIntent(input: {
  hasLogIntent: boolean;
  handled: boolean;
}): boolean {
  return input.hasLogIntent && !input.handled;
}

/**
 * Wave H2 — Drop intent trust:
 * Only auto-open the composer when the URL (or an already-selected sheet)
 * names a resolvable pub (`sel=`). Never silently attach a Spill to the first
 * filtered / first route venue — that was the wrong-pub failure mode.
 * Without a resolvable selection → `fallback` (nearby picker).
 */
export function resolveMapLogIntent(input: ResolveMapLogIntentInput): MapLogIntentResolution {
  if (!input.hasLogIntent) return { status: "inactive" };
  if (!input.loaded) return { status: "pending" };

  const selectedVenueId =
    input.selectedVenueId && input.selectedVenueResolvable && input.selectedVenueIsPub
      ? input.selectedVenueId
      : "";
  if (selectedVenueId) return { status: "open", venueId: selectedVenueId };
  // firstRouteId / firstFilteredVenueId are intentionally ignored for auto-open.
  void input.firstRouteId;
  void input.firstFilteredVenueId;
  return { status: "fallback" };
}

/** Format a short distance chip for the nearby picker (e.g. "120 m", "1.2 km"). */
export function formatLogNearbyDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
