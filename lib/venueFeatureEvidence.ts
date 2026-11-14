const VENUE_FEATURE_SOURCES = ["OpenStreetMap", "Google Places", "Pub website"] as const;

export type VenueFeatureSource = (typeof VENUE_FEATURE_SOURCES)[number];

export type VenueFeatureObservation = readonly [
  value: boolean, source: VenueFeatureSource, observedAt: string,
];

export type VenueFeature = "beerGarden" | "outdoorSeating" | "liveSports" | "dogsWelcome";

const APPROVED_SOURCES: Record<VenueFeature, readonly VenueFeatureSource[]> = {
  beerGarden: ["OpenStreetMap"],
  outdoorSeating: ["OpenStreetMap", "Google Places"],
  liveSports: ["OpenStreetMap"],
  dogsWelcome: ["OpenStreetMap", "Pub website"],
};

export function isVenueFeatureObservation(value: unknown): value is VenueFeatureObservation {
  return Array.isArray(value) && value.length === 3 && typeof value[0] === "boolean"
    && (VENUE_FEATURE_SOURCES as readonly unknown[]).includes(value[1])
    && typeof value[2] === "string" && Number.isFinite(Date.parse(value[2]));
}

export function positiveFeatureObservation(
  observation: VenueFeatureObservation | undefined,
  feature: VenueFeature,
  now: number = Date.now(),
): boolean {
  if (observation?.[0] !== true || !APPROVED_SOURCES[feature].includes(observation[1])) return false;
  const observedAt = Date.parse(observation[2]);
  return Number.isFinite(observedAt) && observedAt <= now;
}
