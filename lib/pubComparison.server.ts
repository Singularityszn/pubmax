import "server-only";

import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { measureNamedInDrinkText } from "@/lib/drinkMeasure";
import { isDrinkCategory, legacyPintPriceObservedAt, namedLegacyPintPriceSource } from "@/lib/drinks";
import { landmarks } from "@/lib/landmarks";
import { loadPintPriceLandingVenuesOrThrow } from "@/lib/pintPriceLandingDataset.server";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import {
  comparisonCatalogueDrinks, comparisonEvidenceEligible, comparePubOrders,
  type PubComparisonCatalogue, type PubComparisonEvidence, type PubComparisonRequest,
  type PubComparisonResponse, type PubComparisonVenueInput, type PubComparisonWalk,
} from "@/lib/pubComparison";
import { authoritativeBundleRows } from "@/lib/ukPriceBundle";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { hasPintPriceSemantics } from "@/lib/venues";
import { legCacheKey, polylineDistanceKm, type LngLat } from "@/lib/walkRoute";
import { reserveOrsBudget } from "@/lib/walkRouteBudget";
import { fetchWalkLeg, orsApiKey } from "@/lib/walkRouteProvider";
import { walkRouteStore } from "@/lib/walkRouteStore";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

export class PubComparisonReadError extends Error {
  constructor(public readonly status: 400 | 404 | 503, message: string) { super(message); }
}

type LocatedVenue = PubComparisonVenueInput & { point: LngLat };

function sourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function sourceDate(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

async function readComparisonVenues(ids: readonly string[], now: number): Promise<LocatedVenue[]> {
  if (!ids.length) return [];
  const [lookups, priced, bundle] = await Promise.all([
    Promise.all(ids.map(lookupCanonicalVenue)),
    loadPintPriceLandingVenuesOrThrow(),
    ukPriceBundleRowsByVenue(),
  ]);
  const canonicalIds = new Set<string>();
  return lookups.map((lookup) => {
    if (lookup.status === "unavailable") throw new PubComparisonReadError(503, "Pub records could not be read.");
    if (lookup.status === "unknown" || lookup.venue.retired || !isPublicRankablePub(lookup.venue)) {
      throw new PubComparisonReadError(404, "A selected pub is not available for comparison.");
    }
    if (cityIdFromVenueId(lookup.canonicalId) !== null || isNationalBaseVenueId(lookup.canonicalId)) {
      throw new PubComparisonReadError(400, "Select London pubs for this comparison.");
    }
    if (canonicalIds.has(lookup.canonicalId)) throw new PubComparisonReadError(400, "Select different pubs for comparison.");
    canonicalIds.add(lookup.canonicalId);
    const venue = priced.find((entry) => entry.id === lookup.canonicalId);
    const evidence: PubComparisonEvidence[] = [];
    if (venue && hasPintPriceSemantics(venue)) for (const price of venue.prices) {
      if (!isLivePriceRow(price) || typeof price.price_gbp !== "number" || !price.pint_name?.trim()
        || measureNamedInDrinkText(price.pint_name) !== null
        || /\b(?:bottles?|bottled|cans?)\b|\d\s*(?:ml|cl|litres?)\b/i.test(price.pint_name)) continue;
      const publisher = namedLegacyPintPriceSource(price);
      evidence.push({ category: "beer", drinkLabel: price.pint_name.trim(), serving: "pint",
        pricePence: Math.round(price.price_gbp * 100), sourceClass: "listed", sourceKind: "directory",
        sourceUrl: sourceUrl(publisher?.url), publisher: publisher?.label ?? null,
        date: sourceDate(legacyPintPriceObservedAt(price)), dateMeaning: "source-read", eligible: false });
    }
    for (const row of authoritativeBundleRows(bundle.byVenue.get(lookup.canonicalId) ?? [])) {
      if (!isDrinkCategory(row.category) || !row.drinkLabel?.trim() || row.lane === "estimate") continue;
      evidence.push({ category: row.category, drinkLabel: row.drinkLabel.trim(), serving: row.servingSize?.trim() || null,
        pricePence: Math.round(row.priceGbp * 100), sourceClass: "listed", sourceKind: row.lane,
        sourceUrl: sourceUrl(row.sourceUrl), publisher: row.publisher,
        date: sourceDate(row.observedAt), dateMeaning: "source-read", eligible: false });
    }
    for (const row of evidence) row.eligible = comparisonEvidenceEligible(row, now);
    return { id: lookup.canonicalId, name: lookup.venue.name, address: venue?.address || null,
      borough: lookup.venue.borough, evidence, readUnavailable: bundle.status === "unavailable",
      point: [lookup.venue.lng, lookup.venue.lat], mapHref: venueMapUrl(lookup.canonicalId) };
  });
}

export async function loadPubComparisonCatalogue(ids: readonly string[], now = Date.now()): Promise<PubComparisonCatalogue> {
  const venues = await readComparisonVenues(ids, now);
  return { status: "ready", venues: venues.map(({ id, name, address, borough }) => ({ id, name, address, borough })),
    drinks: comparisonCatalogueDrinks(venues), meetingPoints: landmarks.map(({ id, name }) => ({ id, name })),
    coverage: venues.some((venue) => venue.readUnavailable) ? "partial" : "ready" };
}

const WALK_UNAVAILABLE: PubComparisonWalk = { status: "unavailable", minutes: null, method: null, timing: null };

async function comparisonWalk(from: LngLat, to: LngLat, signal?: AbortSignal): Promise<PubComparisonWalk> {
  if (signal?.aborted) return WALK_UNAVAILABLE;
  try {
    const store = walkRouteStore();
    const key = legCacheKey(from, to);
    let coordinates = await store.getLeg(key);
    if (!coordinates) {
      const apiKey = orsApiKey();
      if (!apiKey || signal?.aborted) return WALK_UNAVAILABLE;
      const reservation = await reserveOrsBudget(Date.now(), signal);
      if (!reservation) return WALK_UNAVAILABLE;
      try {
        if (!reservation.commit()) return WALK_UNAVAILABLE;
        coordinates = await fetchWalkLeg(from, to, { apiKey, signal });
        if (coordinates) await store.putLeg(key, coordinates);
      } finally { await reservation.release(); }
    }
    if (!coordinates || signal?.aborted) return WALK_UNAVAILABLE;
    return { status: "routed", minutes: walkMinutesFromKm(polylineDistanceKm(coordinates)), method: "ors", timing: "shared-walking-pace" };
  } catch { return WALK_UNAVAILABLE; }
}

export async function loadPubComparison(request: PubComparisonRequest, signal?: AbortSignal, now = Date.now()): Promise<PubComparisonResponse> {
  const meetingPoint = request.meetingPointId ? landmarks.find((point) => point.id === request.meetingPointId) : null;
  if (request.meetingPointId && !meetingPoint) throw new PubComparisonReadError(400, "Select a listed public meeting point.");
  const venues = await readComparisonVenues(request.venueIds, now);
  const result = comparePubOrders({ ...request, venueIds: venues.map((venue) => venue.id) }, venues, now);
  if (meetingPoint) {
    const walks = await Promise.all(venues.map((venue) => comparisonWalk(meetingPoint.coordinates, venue.point, signal)));
    result.meetingPoint = { id: meetingPoint.id, name: meetingPoint.name };
    result.venues.forEach((venue, index) => { venue.walk = walks[index] ?? WALK_UNAVAILABLE; });
  }
  return result;
}
