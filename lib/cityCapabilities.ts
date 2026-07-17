import {
  DEFAULT_CITY_ID,
  parseCityId,
  type CityId,
} from "@/lib/cities";
import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";

export type CityReleaseTier = "flagship" | "core" | "preview";
export type CapabilityAvailability = "available" | "limited" | "unavailable";

export type CityCapabilityEvidence = Readonly<{
  availability: CapabilityAvailability;
  /** ISO collection/review date, or null when no dated evidence exists. */
  asOf: string | null;
  explanation: string;
}>;

export type CityCapabilityProfile = Readonly<{
  cityId: CityId;
  releaseTier: CityReleaseTier;
  map: CityCapabilityEvidence;
  prices: CityCapabilityEvidence;
  events: CityCapabilityEvidence;
  routes: CityCapabilityEvidence;
  transport: CityCapabilityEvidence;
  heritage: CityCapabilityEvidence;
}>;

const MAP_AVAILABLE: CityCapabilityEvidence = {
  availability: "available",
  asOf: null,
  explanation: "A city-scoped slim venue pack is available for browse and search.",
};

const PRICES_NOT_YET_COLLECTED: CityCapabilityEvidence = {
  availability: "unavailable",
  asOf: null,
  explanation: "Observed pint prices have not yet been collected for this city.",
};

const EVENTS_LONDON_ONLY: CityCapabilityEvidence = {
  availability: "unavailable",
  asOf: null,
  explanation: "The reviewed Tonight event feed is not yet available for this city.",
};

const ROUTES_AVAILABLE: CityCapabilityEvidence = {
  availability: "available",
  asOf: null,
  explanation: "Reviewed editorial crawl routes and landmarks are bundled for this city.",
};

const HERITAGE_AVAILABLE: CityCapabilityEvidence = {
  availability: "available",
  asOf: null,
  explanation: "Reviewed landmark and story-band context is bundled for this city.",
};

const TRANSPORT_LIMITED: CityCapabilityEvidence = {
  availability: "limited",
  asOf: null,
  explanation: "Static transport anchors are available; live disruption and journey evidence are not yet certified.",
};

const TRANSPORT_NOT_YET_AVAILABLE: CityCapabilityEvidence = {
  availability: "unavailable",
  asOf: null,
  explanation: "City-specific transport evidence is not yet available.",
};

const EDITORIAL_NOT_YET_AVAILABLE: CityCapabilityEvidence = {
  availability: "unavailable",
  asOf: null,
  explanation: "Reviewed editorial routes and heritage are not yet available for this city.",
};

function editorialCoreCity(
  cityId: Exclude<CityId, "london" | "bath">,
  transport: CityCapabilityEvidence = TRANSPORT_NOT_YET_AVAILABLE,
): CityCapabilityProfile {
  return {
    cityId,
    releaseTier: "core",
    map: MAP_AVAILABLE,
    prices: PRICES_NOT_YET_COLLECTED,
    events: EVENTS_LONDON_ONLY,
    routes: ROUTES_AVAILABLE,
    transport,
    heritage: HERITAGE_AVAILABLE,
  };
}

export const CITY_CAPABILITY_PROFILES = {
  london: {
    cityId: "london",
    releaseTier: "flagship",
    map: MAP_AVAILABLE,
    prices: {
      availability: "available",
      asOf: isoDate(PINT_DATASET_OBSERVED_AT),
      explanation: "The tracked London pint-price snapshot is available with visible collection dates.",
    },
    events: {
      availability: "available",
      asOf: null,
      explanation: "Reviewed London deals, music, quiz, and sport feeds are available with per-item provenance.",
    },
    routes: ROUTES_AVAILABLE,
    transport: {
      availability: "available",
      asOf: null,
      explanation: "TfL routes, live status, and get-home surfaces are available with provider fallbacks.",
    },
    heritage: HERITAGE_AVAILABLE,
  },
  manchester: editorialCoreCity("manchester", TRANSPORT_LIMITED),
  liverpool: editorialCoreCity("liverpool", TRANSPORT_LIMITED),
  oxford: editorialCoreCity("oxford"),
  durham: editorialCoreCity("durham"),
  glasgow: editorialCoreCity("glasgow", TRANSPORT_LIMITED),
  bristol: editorialCoreCity("bristol"),
  cambridge: editorialCoreCity("cambridge"),
  bath: {
    cityId: "bath",
    releaseTier: "core",
    map: MAP_AVAILABLE,
    prices: PRICES_NOT_YET_COLLECTED,
    events: EVENTS_LONDON_ONLY,
    routes: EDITORIAL_NOT_YET_AVAILABLE,
    transport: TRANSPORT_NOT_YET_AVAILABLE,
    heritage: EDITORIAL_NOT_YET_AVAILABLE,
  },
} as const satisfies Record<CityId, CityCapabilityProfile>;

export function getCityCapabilityProfile(
  rawCityId: string | null | undefined,
): CityCapabilityProfile {
  return CITY_CAPABILITY_PROFILES[parseCityId(rawCityId) ?? DEFAULT_CITY_ID];
}
