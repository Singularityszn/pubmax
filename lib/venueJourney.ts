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

const JOURNEY_COORDINATE_DECIMALS = 3;

/**
 * Keep journey planning useful without sending raw device precision downstream.
 * Three decimal places is roughly a 70–110 metre cell in London: enough to find
 * nearby walking/transit options without disclosing a house-level GPS point.
 */
export function privacyRoundedJourneyPoint(
  point: JourneyPoint,
): JourneyPoint {
  const factor = 10 ** JOURNEY_COORDINATE_DECIMALS;
  return {
    lat: Math.round(point.lat * factor) / factor,
    lng: Math.round(point.lng * factor) / factor,
  };
}

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
  const roundedVenue = privacyRoundedJourneyPoint(venue);
  const params = new URLSearchParams({
    api: "1",
    destination: `${roundedVenue.lat},${roundedVenue.lng}`,
    travelmode: "transit",
  });
  if (isFinitePoint(user)) {
    const roundedUser = privacyRoundedJourneyPoint(user);
    params.set("origin", `${roundedUser.lat},${roundedUser.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
