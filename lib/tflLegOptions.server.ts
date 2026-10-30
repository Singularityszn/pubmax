// The TfL read behind "ways to get there" (lib/legOptions.ts): one leg between
// two stops of a night, asked of TfL's Journey Planner through the guarded
// client (lib/tflClient.server.ts, keyless, api.tfl.gov.uk only).
//
// Two questions go out at once: one for tube, bus and rail options (TfL's
// own fares and paths), and one for walking alone (TfL's street path for the
// walk). A transit answer that is only a walk is dropped, so the walk is never
// listed twice. TfL plans no walk over about two kilometres, so then the walk
// is a straight-line estimate, marked as one. TfL can list one route at two
// departure times: the same ride is offered once. Every failure is soft: a
// question that fails adds nothing, and when both fail the answer is null so
// the route can say so.

import { haversineKm } from "@/lib/haversine";
import { legMode, legOptionName, parseTflLineString, rankLegOptions, type LegOption, type LegPart } from "@/lib/legOptions";
import { legMinutes } from "@/lib/routeLegs";
import { tflFetch } from "@/lib/tflClient.server";

/** TfL modes asked for the transit question. */
const TRANSIT_MODES = "tube,bus,overground,elizabeth-line,dlr,national-rail,tram,walking";
/** At most this many transit options are kept, in TfL's order. */
const TRANSIT_OPTIONS_MAX = 3;

type TflJourneyLeg = {
  duration?: number;
  mode?: { id?: string };
  routeOptions?: { name?: string }[];
  path?: { lineString?: string };
};

type TflJourney = {
  duration?: number;
  legs?: TflJourneyLeg[];
  fare?: { totalCost?: number };
};

type TflItinerary = { journeys?: TflJourney[] };

function point(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function toParts(journey: TflJourney): LegPart[] {
  const parts: LegPart[] = [];
  for (const leg of journey.legs ?? []) {
    const minutes = typeof leg.duration === "number" && Number.isFinite(leg.duration) ? Math.max(0, Math.round(leg.duration)) : 0;
    const mode = legMode(leg.mode?.id);
    const name = leg.routeOptions?.[0]?.name?.trim();
    parts.push({
      mode,
      line: mode === "walking" || !name ? null : name,
      minutes,
      path: parseTflLineString(leg.path?.lineString),
    });
  }
  return parts;
}

function minutesOf(journey: TflJourney): number | null {
  return typeof journey.duration === "number" && Number.isFinite(journey.duration) && journey.duration > 0
    ? Math.round(journey.duration)
    : null;
}

/** TfL's fare in whole pence, or null when it lists none. */
function fareOf(journey: TflJourney): number | null {
  const cost = journey.fare?.totalCost;
  return typeof cost === "number" && Number.isInteger(cost) && cost >= 0 ? cost : null;
}

type Point = { lat: number; lng: number };

/** The walk as a straight line between the stops, when TfL plans no walk. */
function straightWalk(from: Point, to: Point): Omit<LegOption, "fastest" | "cheapest"> | null {
  const minutes = legMinutes(haversineKm([from.lng, from.lat], [to.lng, to.lat]));
  if (minutes <= 0) return null;
  const path: [number, number][] = [[from.lng, from.lat], [to.lng, to.lat]];
  return { id: "walk", kind: "walk", minutes, farePence: 0, estimate: true, parts: [{ mode: "walking", line: null, minutes, path }] };
}

/**
 * Pure: the options for one leg from TfL's two answers. Exported for tests.
 * A journey with no time, or with no part that has a path, is not offered.
 * With the leg's ends, a walk TfL did not plan is a straight-line estimate.
 */
export function legOptionsFromTfl(
  transit: TflItinerary | null,
  walking: TflItinerary | null,
  ends?: { from: Point; to: Point },
): LegOption[] {
  const options: Omit<LegOption, "fastest" | "cheapest">[] = [];
  const walkJourney = (walking?.journeys ?? []).find((journey) => minutesOf(journey) !== null);
  const walkParts = walkJourney ? toParts(walkJourney).filter((part) => part.path.length > 0) : [];
  if (walkJourney && walkParts.length) {
    options.push({ id: "walk", kind: "walk", minutes: minutesOf(walkJourney)!, farePence: 0, estimate: false, parts: walkParts });
  } else if (ends) {
    const estimate = straightWalk(ends.from, ends.to);
    if (estimate) options.push(estimate);
  }
  const offered = new Set<string>();
  let index = 0;
  for (const journey of transit?.journeys ?? []) {
    if (index >= TRANSIT_OPTIONS_MAX) break;
    const minutes = minutesOf(journey);
    if (minutes === null) continue;
    const parts = toParts(journey);
    // A walk-only answer is the walk again: never listed twice.
    if (!parts.some((part) => part.mode !== "walking")) continue;
    if (!parts.some((part) => part.path.length > 0)) continue;
    const option = { id: `transit-${index}`, kind: "transit" as const, minutes, farePence: fareOf(journey), estimate: false, parts };
    // One route at two departure times is one way to go.
    const same = `${legOptionName(option)}|${minutes}|${option.farePence ?? "none"}`;
    if (offered.has(same)) continue;
    offered.add(same);
    options.push(option);
    index += 1;
  }
  return options.length ? rankLegOptions(options) : [];
}

/** The ways to get from one stop to the next, or null when TfL answered neither question. */
export async function fetchLegOptions(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<LegOption[] | null> {
  const base = `/Journey/JourneyResults/${point(from.lat, from.lng)}/to/${point(to.lat, to.lng)}`;
  const [transit, walking] = await Promise.all([
    tflFetch<TflItinerary>(`${base}?mode=${TRANSIT_MODES}&journeyPreference=leasttime&walkingSpeed=average`, options),
    tflFetch<TflItinerary>(`${base}?mode=walking&walkingSpeed=average`, options),
  ]);
  // A walk TfL cannot plan is a 404, an answer and not a failure.
  if (!transit.ok && !walking.ok && (transit.retryable || walking.retryable)) return null;
  return legOptionsFromTfl(transit.ok ? transit.data : null, walking.ok ? walking.data : null, { from, to });
}
