// Multi-city map configuration foundation.
// London stays the default flagship. Every city with a shipped OSM slim pack is
// enabled for browse; Manchester also ships editorial landmarks/crawls/POIs.

export type CityId =
  | "london"
  | "manchester"
  | "liverpool"
  | "oxford"
  | "durham"
  | "glasgow"
  | "bristol"
  | "cambridge"
  | "bath";

export type CityBounds = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type CityMapView = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

export type CityConfig = {
  id: CityId;
  displayName: string;
  tagline: string;
  country: "england" | "scotland";
  bounds: CityBounds;
  mapView: CityMapView;
  /** Browser-shipped slim venues path (London keeps existing path for back-compat) */
  slimVenuesPath: string;
  poisPath: string | null;
  transitLinesPath: string | null;
  lastRideLabel: string; // "Last Pint" | "Last Tram" | "Last Subway" | "Last Train"
  /** Browseable when a slim venue pack ships under public/data. */
  enabled: boolean;
};

const CITY_IDS: readonly CityId[] = [
  "london",
  "manchester",
  "liverpool",
  "oxford",
  "durham",
  "glasgow",
  "bristol",
  "cambridge",
  "bath",
] as const;

const CITY_ID_SET = new Set<string>(CITY_IDS);

/** Shared cinematic tilt for every city map (matches London's opening camera). */
const DEFAULT_PITCH = 42;
const DEFAULT_BEARING = -12;

function city(
  partial: Omit<CityConfig, "mapView"> & {
    mapView: Pick<CityMapView, "center" | "zoom"> &
      Partial<Pick<CityMapView, "pitch" | "bearing">>;
  },
): CityConfig {
  const { mapView, ...rest } = partial;
  return {
    ...rest,
    mapView: {
      center: mapView.center,
      zoom: mapView.zoom,
      pitch: mapView.pitch ?? DEFAULT_PITCH,
      bearing: mapView.bearing ?? DEFAULT_BEARING,
    },
  };
}

export const CITIES: Record<CityId, CityConfig> = {
  london: city({
    id: "london",
    displayName: "London",
    tagline: "Price-aware crawls across the capital",
    country: "england",
    bounds: { latMin: 51.28, latMax: 51.72, lonMin: -0.55, lonMax: 0.35 },
    mapView: { center: [-0.12, 51.52], zoom: 9.85, pitch: 42, bearing: -12 },
    slimVenuesPath: "/data/venues_slim.json",
    poisPath: "/data/london_pois.json",
    transitLinesPath: "/data/tfl_lines.json",
    lastRideLabel: "Last Pint",
    enabled: true,
  }),
  manchester: city({
    id: "manchester",
    displayName: "Manchester",
    tagline: "Northern Quarter rounds and tram-home timing",
    country: "england",
    bounds: { latMin: 53.38, latMax: 53.55, lonMin: -2.35, lonMax: -2.1 },
    mapView: { center: [-2.24, 53.48], zoom: 11.2 },
    slimVenuesPath: "/data/cities/manchester/venues_slim.json",
    poisPath: "/data/cities/manchester/pois.json",
    transitLinesPath: null,
    lastRideLabel: "Last Tram",
    enabled: true,
  }),
  liverpool: city({
    id: "liverpool",
    displayName: "Liverpool",
    tagline: "Waterfront crawls and Merseyrail last rides",
    country: "england",
    bounds: { latMin: 53.35, latMax: 53.48, lonMin: -3.05, lonMax: -2.85 },
    mapView: { center: [-2.98, 53.41], zoom: 11.4 },
    slimVenuesPath: "/data/cities/liverpool/venues_slim.json",
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
    // OSM slim pack shipped — browseable; editorial crawls land in later waves.
    enabled: true,
  }),
  oxford: city({
    id: "oxford",
    displayName: "Oxford",
    tagline: "College-town pints and riverside walks",
    country: "england",
    bounds: { latMin: 51.72, latMax: 51.8, lonMin: -1.3, lonMax: -1.2 },
    mapView: { center: [-1.26, 51.75], zoom: 12.2 },
    slimVenuesPath: "/data/cities/oxford/venues_slim.json",
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
    enabled: true,
  }),
  durham: city({
    id: "durham",
    displayName: "Durham",
    tagline: "Cathedral-city snugs on a compact map",
    country: "england",
    bounds: { latMin: 54.76, latMax: 54.8, lonMin: -1.6, lonMax: -1.54 },
    mapView: { center: [-1.575, 54.78], zoom: 13 },
    slimVenuesPath: "/data/cities/durham/venues_slim.json",
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
    enabled: true,
  }),
  glasgow: city({
    id: "glasgow",
    displayName: "Glasgow",
    tagline: "West End crawls and Subway last rides",
    country: "scotland",
    bounds: { latMin: 55.82, latMax: 55.9, lonMin: -4.35, lonMax: -4.15 },
    mapView: { center: [-4.25, 55.86], zoom: 11.5 },
    slimVenuesPath: "/data/cities/glasgow/venues_slim.json",
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Subway",
    enabled: true,
  }),
  bristol: city({
    id: "bristol",
    displayName: "Bristol",
    tagline: "Harbour-side rounds and hillside pubs",
    country: "england",
    bounds: { latMin: 51.42, latMax: 51.5, lonMin: -2.65, lonMax: -2.52 },
    mapView: { center: [-2.59, 51.45], zoom: 11.8 },
    slimVenuesPath: "/data/cities/bristol/venues_slim.json",
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
    enabled: true,
  }),
  cambridge: city({
    id: "cambridge",
    displayName: "Cambridge",
    tagline: "Back-lane pubs and riverside college crawls",
    country: "england",
    bounds: { latMin: 52.18, latMax: 52.24, lonMin: 0.08, lonMax: 0.16 },
    mapView: { center: [0.12, 52.205], zoom: 12.4 },
    slimVenuesPath: "/data/cities/cambridge/venues_slim.json",
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
    enabled: true,
  }),
  bath: city({
    id: "bath",
    displayName: "Bath",
    tagline: "Georgian streets and spa-city last trains",
    country: "england",
    bounds: { latMin: 51.36, latMax: 51.4, lonMin: -2.4, lonMax: -2.32 },
    mapView: { center: [-2.36, 51.38], zoom: 12.8 },
    slimVenuesPath: "/data/cities/bath/venues_slim.json",
    poisPath: null,
    transitLinesPath: null,
    lastRideLabel: "Last Train",
    enabled: true,
  }),
};

export const DEFAULT_CITY_ID: CityId = "london";

export function parseCityId(raw: string | null | undefined): CityId | null {
  if (raw == null) return null;
  const id = raw.trim().toLowerCase();
  return CITY_ID_SET.has(id) ? (id as CityId) : null;
}

export function getCity(id: string | null | undefined): CityConfig {
  return CITIES[parseCityId(id) ?? DEFAULT_CITY_ID];
}

export function listEnabledCities(): CityConfig[] {
  return CITY_IDS.map((id) => CITIES[id]).filter((c) => c.enabled);
}

export function pointInCityBounds(
  lat: number,
  lng: number,
  cityConfig: CityConfig,
): boolean {
  const { latMin, latMax, lonMin, lonMax } = cityConfig.bounds;
  return lat >= latMin && lat <= latMax && lng >= lonMin && lng <= lonMax;
}

/** MapLibre `maxBounds` tuple from a city's lat/lon box. */
export function cityMaxBounds(
  cityConfig: CityConfig,
): [[number, number], [number, number]] {
  const { lonMin, latMin, lonMax, latMax } = cityConfig.bounds;
  return [
    [lonMin, latMin],
    [lonMax, latMax],
  ];
}
