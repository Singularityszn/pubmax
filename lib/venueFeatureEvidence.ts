const VENUE_FEATURE_SOURCES = ["OpenStreetMap", "Google Places", "Pub website"] as const;

export type VenueFeatureSource = (typeof VENUE_FEATURE_SOURCES)[number];

export type VenueFeatureObservation = readonly [
  value: boolean, source: VenueFeatureSource, observedAt: string,
];

export type VenueFeature = "beerGarden" | "outdoorSeating" | "liveSports" | "dogsWelcome" | "darts" | "pool";

const APPROVED_SOURCES: Record<VenueFeature, readonly VenueFeatureSource[]> = {
  beerGarden: ["OpenStreetMap"],
  outdoorSeating: ["OpenStreetMap", "Google Places"],
  liveSports: ["OpenStreetMap"],
  dogsWelcome: ["OpenStreetMap", "Pub website"],
  darts: ["Pub website"],
  pool: ["Pub website"],
};

function observedInstant(observedAt: string): number {
  const day = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(observedAt)?.[1];
  const instant = Date.parse(observedAt);
  if (!day || !Number.isFinite(instant)) return Number.NaN;
  return new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day ? instant : Number.NaN;
}

export function isVenueFeatureObservation(value: unknown): value is VenueFeatureObservation {
  return Array.isArray(value) && value.length === 3 && typeof value[0] === "boolean"
    && (VENUE_FEATURE_SOURCES as readonly unknown[]).includes(value[1])
    && typeof value[2] === "string" && Number.isFinite(observedInstant(value[2]));
}

export function positiveFeatureObservation(
  observation: VenueFeatureObservation | undefined,
  feature: VenueFeature,
  now: number = Date.now(),
): boolean {
  if (observation?.[0] !== true || !APPROVED_SOURCES[feature].includes(observation[1])) return false;
  const observedAt = observedInstant(observation[2]);
  return Number.isFinite(observedAt) && observedAt <= now;
}
