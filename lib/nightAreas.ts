import type { CityId } from "@/lib/cities";
import type { Daypart } from "@/lib/nightPlanning";
import derivedAreaData from "@/public/data/night_areas/uk_cities.json";
import { nearestCompactNightArea } from "@/lib/nightAreaGeometry";

import type { NightAreaSlug } from "@/lib/nightAreaSlugs";

export {
  DERIVED_NIGHT_AREA_SLUGS,
  LONDON_NIGHT_AREA_SLUGS,
  NIGHT_AREA_SLUGS,
  type LondonNightAreaSlug,
  type NightAreaSlug,
} from "@/lib/nightAreaSlugs";

export type CoverageStatus = "discovered" | "captured" | "reviewed" | "route_ready" | "paused";

const ROUTE_READY_GATE_CODES = [
  "venue_density", "identity_conflict", "price_coverage", "amenity_coverage", "opening_hours",
  "transport_anchor", "route_feasibility", "terminal_get_home", "terminal_food", "stale_review", "unreviewed_source",
] as const;
type RouteReadyGateCode = (typeof ROUTE_READY_GATE_CODES)[number];

const ROUTE_READY_GATE_VERSION = 1;

type RecentSignal = {
  id: string; sourceUrl: string; publisher: string; publishedAt: string; claim: string;
  confidence: number; reviewStatus: "reviewed"; expiresAt: string;
};

type GateCheck = {
  code: RouteReadyGateCode;
  required: boolean;
  passed: boolean;
  observed: number | string | null;
  threshold?: number | string;
  evidenceRefs: string[];
};

type NightAreaGate = { version: typeof ROUTE_READY_GATE_VERSION; passed: boolean; checks: GateCheck[] };

export type NightArea = {
  slug: NightAreaSlug;
  cityId: CityId;
  name: string;
  aliases: string[];
  centre: { lat: number; lng: number };
  radiusKm: number;
  transportAnchors: string[];
  demandWave: 0 | 1 | 2 | 3;
  description: string;
  daypartGuidance: Record<Daypart, string>;
  recentSignals: RecentSignal[];
  coverageStatus: CoverageStatus;
  coverageScore: number;
  routeReadyReasons: RouteReadyGateCode[];
  missingEvidence: RouteReadyGateCode[];
  gate: NightAreaGate;
  lastReviewedAt: string | null;
  reviewExpiresAt: string | null;
};

const REQUIRED_GATE_CODES = ROUTE_READY_GATE_CODES.filter((code) => code !== "stale_review") as RouteReadyGateCode[];

const guidance = (afterWork: string, lateNight: string): Record<Daypart, string> => ({
  daytime: "Start with food-friendly pubs and quieter rooms.",
  after_work: afterWork,
  evening: "Balance atmosphere, pint price and a walkable three-stop crawl.",
  late_night: lateNight,
  get_home: "Prioritise a simple route to a reliable transport anchor.",
});

// The catalogue has no review evidence source. Geography does not certify a route.
function coverage(): Pick<NightArea, "coverageStatus" | "coverageScore" | "routeReadyReasons" | "missingEvidence" | "gate" | "lastReviewedAt" | "reviewExpiresAt"> {
  return {
    coverageStatus: "discovered",
    coverageScore: 0,
    routeReadyReasons: [],
    missingEvidence: [...REQUIRED_GATE_CODES],
    gate: { version: ROUTE_READY_GATE_VERSION, passed: false, checks: REQUIRED_GATE_CODES.map((code) => ({
      code, required: true, passed: false, observed: null, evidenceRefs: [],
    })) },
    lastReviewedAt: null,
    reviewExpiresAt: null,
  };
}

type AreaSeed = Omit<NightArea, "daypartGuidance" | "recentSignals" | "coverageStatus" | "coverageScore" | "routeReadyReasons" | "missingEvidence" | "gate" | "lastReviewedAt" | "reviewExpiresAt"> & {
  afterWork: string;
  lateNight: string;
  coverage: ReturnType<typeof coverage>;
};


const AREA_SEEDS: readonly AreaSeed[] = [
  { slug: "clapham", cityId: "london", name: "Clapham", aliases: ["Clapham Common", "Clapham Junction"], centre: { lat: 51.462, lng: -0.138 }, radiusKm: 2.4, transportAnchors: ["Clapham Common", "Clapham Junction"], demandWave: 0, description: "A south-London night centred on the Common, Junction and compact pub walks.", afterWork: "Begin near the station, then move toward the Common.", lateNight: "Keep the ending close to food and Night Tube connections.", coverage: coverage() },
  { slug: "victoria", cityId: "london", name: "Victoria", aliases: ["Pimlico"], centre: { lat: 51.496, lng: -0.143 }, radiusKm: 1.5, transportAnchors: ["Victoria"], demandWave: 0, description: "A practical central start for post-office drinks and an easy route home.", afterWork: "Optimise for a quick post-office start and commuter access.", lateNight: "Finish close to Victoria station and confirmed late transport.", coverage: coverage() },
  { slug: "piccadilly-soho", cityId: "london", name: "Piccadilly & Soho", aliases: ["Piccadilly", "Soho"], centre: { lat: 51.511, lng: -0.134 }, radiusKm: 1.4, transportAnchors: ["Piccadilly Circus", "Oxford Circus", "Tottenham Court Road"], demandWave: 0, description: "A dense West End patch where pint prices are still being checked.", afterWork: "Avoid unnecessary crossings and favour bookable group space.", lateNight: "Expect crowds; favour short walks and checked closing times.", coverage: coverage() },
  { slug: "canary-wharf", cityId: "london", name: "Canary Wharf", aliases: ["West India Quay"], centre: { lat: 51.505, lng: -0.022 }, radiusKm: 1.8, transportAnchors: ["Canary Wharf", "West India Quay"], demandWave: 0, description: "A waterside and after-work district with clear rail anchors.", afterWork: "Start close to offices, then move toward waterside venues.", lateNight: "Keep the final stop near the Elizabeth line or Jubilee line.", coverage: coverage() },
  { slug: "barnes", cityId: "london", name: "Barnes", aliases: ["Barnes Bridge"], centre: { lat: 51.474, lng: -0.239 }, radiusKm: 1.8, transportAnchors: ["Barnes", "Barnes Bridge"], demandWave: 0, description: "A relaxed riverside patch where late opening and travel details still need checking.", afterWork: "Lean into relaxed riverside and neighbourhood pubs.", lateNight: "Plan the return early because late transport is less frequent.", coverage: coverage() },
  { slug: "chiswick", cityId: "london", name: "Chiswick", aliases: ["Turnham Green"], centre: { lat: 51.493, lng: -0.255 }, radiusKm: 2, transportAnchors: ["Turnham Green", "Chiswick"], demandWave: 0, description: "A west-London patch with some opening and food details still to check.", afterWork: "Build westward from Turnham Green with a compact route.", lateNight: "End near a dependable bus or Tube connection.", coverage: coverage() },
  { slug: "shoreditch", cityId: "london", name: "Shoreditch", aliases: ["Old Street", "Hoxton"], centre: { lat: 51.524, lng: -0.079 }, radiusKm: 1.6, transportAnchors: ["Old Street", "Shoreditch High Street"], demandWave: 1, description: "A busy east-London patch where route details are still being checked.", afterWork: "Start near Old Street before choosing a compact eastward route.", lateNight: "Check the final transport anchor before committing to a route.", coverage: coverage() },
  { slug: "camden", cityId: "london", name: "Camden", aliases: ["Camden Town", "Chalk Farm"], centre: { lat: 51.539, lng: -0.143 }, radiusKm: 1.7, transportAnchors: ["Camden Town", "Chalk Farm"], demandWave: 1, description: "A busy north-London patch where route details are still being checked.", afterWork: "Use station anchors to keep the route compact.", lateNight: "Check closing times and the route home.", coverage: coverage() },
  { slug: "brixton", cityId: "london", name: "Brixton", aliases: ["Brixton Village"], centre: { lat: 51.461, lng: -0.115 }, radiusKm: 1.5, transportAnchors: ["Brixton"], demandWave: 1, description: "A busy south-London patch where route details are still being checked.", afterWork: "Start close to Brixton station and avoid a sprawling route.", lateNight: "Keep the final route tied to a checked transport stop.", coverage: coverage() },
  { slug: "bermondsey-london-bridge", cityId: "london", name: "Bermondsey & London Bridge", aliases: ["Bermondsey", "London Bridge", "Borough"], centre: { lat: 51.504, lng: -0.082 }, radiusKm: 1.5, transportAnchors: ["London Bridge", "Bermondsey"], demandWave: 1, description: "A riverside and rail-connected patch south of the Thames where route details are still being checked.", afterWork: "Use London Bridge as the planned start or ending anchor.", lateNight: "Keep walks short and check the final transport options.", coverage: coverage() },
  { slug: "kings-cross", cityId: "london", name: "King's Cross", aliases: ["Kings Cross", "Coal Drops Yard"], centre: { lat: 51.531, lng: -0.124 }, radiusKm: 1.3, transportAnchors: ["King's Cross St Pancras"], demandWave: 1, description: "A station-led patch for arrival and get-home planning, with route details still being checked.", afterWork: "Make the station a deliberate start or ending anchor.", lateNight: "Check final opening times and onward travel.", coverage: coverage() },
  { slug: "islington", cityId: "london", name: "Islington", aliases: ["Angel", "Upper Street"], centre: { lat: 51.534, lng: -0.104 }, radiusKm: 1.6, transportAnchors: ["Angel", "Highbury & Islington"], demandWave: 1, description: "A busy north-London patch around Angel and Upper Street where route details are still being checked.", afterWork: "Start around Angel and choose a short, coherent crawl.", lateNight: "Use a checked station rather than assuming late options.", coverage: coverage() },
  { slug: "dalston", cityId: "london", name: "Dalston", aliases: ["Dalston Junction", "Dalston Kingsland"], centre: { lat: 51.546, lng: -0.075 }, radiusKm: 1.5, transportAnchors: ["Dalston Junction", "Dalston Kingsland"], demandWave: 2, description: "An east-London patch we have not checked yet.", afterWork: "Have a browse while we check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
  { slug: "peckham", cityId: "london", name: "Peckham", aliases: ["Peckham Rye", "Bellenden Road"], centre: { lat: 51.473, lng: -0.069 }, radiusKm: 1.6, transportAnchors: ["Peckham Rye"], demandWave: 2, description: "A south-London patch we have not checked yet.", afterWork: "Have a browse while we check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
  { slug: "greenwich", cityId: "london", name: "Greenwich", aliases: ["Greenwich Market", "Cutty Sark"], centre: { lat: 51.482, lng: -0.009 }, radiusKm: 1.6, transportAnchors: ["Cutty Sark", "Greenwich"], demandWave: 2, description: "A riverside patch we have not checked yet.", afterWork: "Have a browse while we check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
  { slug: "hammersmith", cityId: "london", name: "Hammersmith", aliases: ["Hammersmith Broadway", "Ravenscourt Park"], centre: { lat: 51.492, lng: -0.224 }, radiusKm: 1.6, transportAnchors: ["Hammersmith", "Ravenscourt Park"], demandWave: 2, description: "A west-London patch we have not checked yet.", afterWork: "Have a browse while we check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
  { slug: "balham", cityId: "london", name: "Balham", aliases: ["Balham Station"], centre: { lat: 51.443, lng: -0.152 }, radiusKm: 1.4, transportAnchors: ["Balham"], demandWave: 2, description: "A south-London patch we have not checked yet.", afterWork: "Have a browse while we check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
  { slug: "marylebone", cityId: "london", name: "Marylebone", aliases: ["Baker Street", "Marylebone High Street"], centre: { lat: 51.522, lng: -0.163 }, radiusKm: 1.4, transportAnchors: ["Baker Street", "Marylebone"], demandWave: 2, description: "A central-London patch we have not checked yet.", afterWork: "Have a browse while we check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
  { slug: "richmond", cityId: "london", name: "Richmond", aliases: ["Richmond Station", "Richmond Riverside"], centre: { lat: 51.461, lng: -0.303 }, radiusKm: 1.7, transportAnchors: ["Richmond"], demandWave: 2, description: "Prices and route details in this outer-London patch need checking.", afterWork: "Have a browse while you check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
  { slug: "putney", cityId: "london", name: "Putney", aliases: ["Putney Bridge", "East Putney"], centre: { lat: 51.461, lng: -0.216 }, radiusKm: 1.5, transportAnchors: ["Putney", "East Putney", "Putney Bridge"], demandWave: 2, description: "A riverside patch we have not checked yet.", afterWork: "Have a browse while we check prices and route details.", lateNight: "Check opening times and travel before you go.", coverage: coverage() },
];

/**
 * The areas DERIVED for the cities outside London, out of the OpenStreetMap base
 * layer (`scripts/build_city_night_areas.mjs`).
 *
 * They arrive `discovered`: the base layer states a name, a place and the pubs
 * around it, and nothing else. It holds no price, no opening hour and no
 * station, so every one of those stays in `missingEvidence` and
 * `transportAnchors` is EMPTY rather than carrying a station nobody read. That
 * is the same answer London's own unchecked patches give, and it is what keeps
 * these areas out of route readiness, priced landings and the sitemap.
 */
const derivedSeeds: readonly AreaSeed[] = derivedAreaData.areas.map((area) => ({
  slug: area.slug as NightAreaSlug,
  cityId: area.cityId as CityId,
  name: area.name,
  aliases: [],
  centre: { lat: area.centre.lat, lng: area.centre.lng },
  radiusKm: area.radiusKm,
  transportAnchors: [],
  demandWave: 3,
  // The count, not a restatement of the name above it: how many pubs the base
  // layer puts inside this circle is the one thing the row can honestly add.
  description: `${area.pubCount} pubs on the map. Prices and route details are not checked yet.`,
  afterWork: "Have a browse while we check prices and route details.",
  lateNight: "Check opening times and travel before you go.",
  coverage: coverage(),
}));

export const NIGHT_AREAS: readonly NightArea[] = [...AREA_SEEDS, ...derivedSeeds].map(
  ({ afterWork, lateNight, coverage: snapshot, ...area }) => ({
    ...area,
    daypartGuidance: guidance(afterWork, lateNight),
    recentSignals: [],
    ...snapshot,
  }),
);

export function validateNightAreaCatalogue(areas: readonly unknown[]): void {
  const errors: string[] = [];
  const slugs = new Set<string>();
  const aliases = new Set<string>();
  for (const area of areas) {
    if (!area || typeof area !== "object" || Array.isArray(area)) {
      errors.push("Night Area must be an object.");
      continue;
    }
    const value = area as Record<string, unknown>;
    const slug = typeof value.slug === "string" ? value.slug.trim().toLowerCase() : "";
    if (!slug) errors.push("Night Area slug is required.");
    else if (slugs.has(slug)) errors.push(`Duplicate Night Area slug: ${slug}.`);
    else slugs.add(slug);
    const centre = value.centre as { lat?: unknown; lng?: unknown } | undefined;
    if (!centre || typeof centre.lat !== "number" || typeof centre.lng !== "number" || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lng) || centre.lat < -90 || centre.lat > 90 || centre.lng < -180 || centre.lng > 180) errors.push(`Invalid coordinates for Night Area ${slug || "(unknown)"}.`);
    // The base layer names no stations, so derived areas keep an empty list.
    // Missing transport evidence lowers confidence without blocking a described draft.
    // Supplied anchor names must still be non-empty strings.
    if (!Array.isArray(value.transportAnchors) || value.transportAnchors.some((anchor) => typeof anchor !== "string" || !anchor.trim())) errors.push(`Night Area ${slug || "(unknown)"} has an invalid transport anchor.`);
    if (!Array.isArray(value.aliases)) errors.push(`Night Area ${slug || "(unknown)"} aliases must be an array.`);
    else for (const alias of value.aliases) {
      const normalized = typeof alias === "string" ? alias.trim().toLocaleLowerCase() : "";
      if (!normalized) errors.push(`Night Area ${slug || "(unknown)"} has an invalid alias.`);
      else if (aliases.has(normalized)) errors.push(`Duplicate Night Area alias: ${normalized}.`);
      else aliases.add(normalized);
    }
  }
  if (errors.length) throw new Error(errors.join(" "));
}

validateNightAreaCatalogue(NIGHT_AREAS);

export function getNightArea(slug: NightAreaSlug): NightArea {
  return NIGHT_AREAS.find((area) => area.slug === slug)!;
}

/**
 * Same lookup as `getNightArea`, but answers `null` instead of throwing when
 * `slug` no longer names a catalogue entry (a stale/renamed area referenced
 * by persisted client state, such as a check-in row or a `localStorage` plan draft).
 */
export function tryGetNightArea(slug: string | null | undefined): NightArea | null {
  if (!slug) return null;
  return NIGHT_AREAS.find((area) => area.slug === slug) ?? null;
}

/**
 * Every area grouped under the city it is in, in catalogue order.
 *
 * The one shape a PICKER needs. A flat list of every area was fine while every
 * area was London's; with four more cities in the catalogue two of them can
 * print the same name, and a reader choosing between two rows reading
 * "City centre" is choosing blind.
 */
export function nightAreasByCity(): Array<{ cityId: CityId; areas: NightArea[] }> {
  const grouped = new Map<CityId, NightArea[]>();
  for (const area of NIGHT_AREAS) {
    const held = grouped.get(area.cityId);
    if (held) held.push(area);
    else grouped.set(area.cityId, [area]);
  }
  return [...grouped].map(([cityId, areas]) => ({ cityId, areas }));
}

export function getNightAreasForCity(cityId: CityId): NightArea[] {
  return NIGHT_AREAS.filter((area) => area.cityId === cityId);
}

/** Suggests a public Night Area from the visible map centre without using location history. */
export function nearestNightAreaForViewport(cityId: CityId, center: [number, number]): NightArea | null {
  return nearestCompactNightArea(getNightAreasForCity(cityId), center);
}

/**
 * The nearest area a crawl can be planned in. A planner that opens with an
 * area already chosen must never pick one the app itself calls not crawl-ready,
 * so a default area comes from here and not from `nearestNightAreaForViewport`.
 * Null when the city has no route-ready area at all.
 */
export function nearestRouteReadyNightArea(
  cityId: CityId,
  center: [number, number],
  now = new Date(),
): NightArea | null {
  const [lng, lat] = center;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return getNightAreasForCity(cityId)
    .filter((area) => isNightAreaRouteReady(area, now))
    .map((area) => ({
      area,
      distance: Math.hypot((area.centre.lat - lat) * 111, (area.centre.lng - lng) * 70),
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.area ?? null;
}

export function nightAreaForMapQuery(cityId: CityId, query: string): NightArea | null {
  const normalized = query.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (!normalized) return null;
  return NIGHT_AREAS.find((area) => area.cityId === cityId &&
    [area.name, ...area.aliases].some((label) => label.toLocaleLowerCase().replace(/\s+/g, " ") === normalized)) ?? null;
}

/** No supplied reference is a review until a review evidence source exists. */
export function nightAreaHasRouteReadyProof(area: NightArea): boolean {
  void area;
  return false;
}

export function isNightAreaRouteReady(area: NightArea, now = new Date()): boolean {
  if (!nightAreaHasRouteReadyProof(area) || !area.lastReviewedAt || !area.reviewExpiresAt) {
    return false;
  }
  const reviewedAt = Date.parse(area.lastReviewedAt);
  const expiresAt = Date.parse(area.reviewExpiresAt);
  if (
    !Number.isFinite(reviewedAt) ||
    !Number.isFinite(expiresAt) ||
    reviewedAt > now.getTime() ||
    reviewedAt >= expiresAt ||
    expiresAt <= now.getTime()
  ) return false;
  return true;
}

export function publicNightAreaCoverage(area: NightArea): Pick<NightArea, "slug" | "coverageStatus" | "coverageScore" | "routeReadyReasons" | "missingEvidence" | "gate" | "lastReviewedAt" | "reviewExpiresAt"> & { routeReady: boolean } {
  return {
    slug: area.slug,
    coverageStatus: area.coverageStatus,
    coverageScore: area.coverageScore,
    routeReadyReasons: area.routeReadyReasons,
    missingEvidence: area.missingEvidence,
    gate: area.gate,
    lastReviewedAt: area.lastReviewedAt,
    reviewExpiresAt: area.reviewExpiresAt,
    routeReady: isNightAreaRouteReady(area),
  };
}
