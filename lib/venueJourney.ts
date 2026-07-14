export type VenueJourneyLeg = {
  mode: string;
  summary?: string;
  durationMinutes?: number;
  departureTime?: string;
  arrivalTime?: string;
};

export type VenueJourney = {
  durationMinutes: number;
  departureTime?: string;
  arrivalTime?: string;
  legs: VenueJourneyLeg[];
};

export type JourneyPoint = {
  lat: number;
  lng: number;
};

function isFinitePoint(point: JourneyPoint | null): point is JourneyPoint {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng),
  );
}

/** Pick the shortest usable itinerary without mutating the API response. */
export function optimalJourney(
  journeys: readonly VenueJourney[],
): VenueJourney | null {
  let best: VenueJourney | null = null;
  for (const journey of journeys) {
    if (
      !Number.isFinite(journey.durationMinutes) ||
      journey.durationMinutes < 0 ||
      journey.legs.length === 0
    ) {
      continue;
    }
    if (!best || journey.durationMinutes < best.durationMinutes) best = journey;
  }
  return best;
}

/** Google Maps directions link; includes the viewer as origin when known. */
export function venueDirectionsUrl(
  venue: JourneyPoint,
  user: JourneyPoint | null,
): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${venue.lat},${venue.lng}`,
    travelmode: "transit",
  });
  if (isFinitePoint(user)) {
    params.set("origin", `${user.lat},${user.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
