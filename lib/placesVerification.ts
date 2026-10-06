/**
 * This ledger verifies our OSM venues. Copied content has a separate dated lane.
 *
 * A committed row may hold our venue id, the Google place id, a verdict we
 * derived (whether a cafe's OSM hours agree with Google), and the day we
 * checked. Pub closure lives only in closed_pubs.json as OSM refs. Google's
 * hours and names are compared in memory and dropped by the verification job.
 * Captain decision 4 October 2026 authorises copying Places fields for verified
 * ids into the places_enrichment*.json packs. See placesEnrichment.ts.
 */

import type { WeeklyOpeningHours } from "@/lib/busyness";

/** Hard circle around the OSM point. One place id inside it is a match. */
export const PLACES_MATCH_RADIUS_METERS = 100;

const EARTH_RADIUS_M = 6_371_000;

/** IDs-only Text Search. Any wider mask bills a paid SKU. */
export const PLACES_TEXT_SEARCH_FIELD_MASK = "places.id";

/**
 * Place Details Pro. `displayName` is read in memory to confirm the match
 * before a closure counts; it is never stored.
 */
export const PLACES_PUB_DETAILS_FIELD_MASK = "businessStatus,displayName";

/**
 * Place Details Enterprise, and only the period list. The periods are read in
 * memory to check our OSM hours; the weekday sentences stay off the mask.
 */
export const PLACES_CAFE_DETAILS_FIELD_MASK =
  "businessStatus,regularOpeningHours.periods";

export const PLACE_DETAILS_PRO_USD_PER_THOUSAND = 17;
export const PLACE_DETAILS_PRO_FREE_MONTHLY = 5_000;
export const PLACE_DETAILS_ENTERPRISE_USD_PER_THOUSAND = 20;
export const PLACE_DETAILS_ENTERPRISE_FREE_MONTHLY = 1_000;
export const PLACES_VERIFY_JOB_CAP_USD = 12;

const SHOREDITCH_COFFEE_BOX = {
  minLat: 51.5215,
  maxLat: 51.5305,
  minLng: -0.0835,
  maxLng: -0.0705,
} as const;

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const LAYER_VENUE_ID = /^venue-(?:uk|osm)-([nwr]\d+)$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,}$/;

export type IdOnlyMatch =
  | { outcome: "matched"; placeId: string }
  | { outcome: "skipped"; reason: "no_result" | "ambiguous" };

export type PlacesPubVerification = {
  venueId: string;
  googlePlaceId: string;
  verifiedAt: string;
};

/**
 * `closed` hides the pub. `closed_unconfirmed` is Google saying closed for a
 * place whose name does not match ours; it goes to human review only.
 */
export type PubClosureVerdict = "open" | "closed" | "closed_unconfirmed";

export const OSM_HOURS_VERDICTS = ["agree", "disagree", "no_osm_hours"] as const;
export type OsmHoursVerdict = (typeof OSM_HOURS_VERDICTS)[number];

export type PlacesCafeVerification = {
  venueId: string;
  googlePlaceId: string;
  osmHoursVerdict: OsmHoursVerdict;
  verifiedAt: string;
};

type ClockPoint = { day: number; hour: number; minute: number };

export function isInShoreditchCoffeeBox(lat: number, lng: number): boolean {
  return (
    lat >= SHOREDITCH_COFFEE_BOX.minLat
    && lat <= SHOREDITCH_COFFEE_BOX.maxLat
    && lng >= SHOREDITCH_COFFEE_BOX.minLng
    && lng <= SHOREDITCH_COFFEE_BOX.maxLng
  );
}

function extractUkPostcode(address: string): string | null {
  const match = UK_POSTCODE.exec(address);
  if (!match?.[1]) return null;
  return match[1].replace(/\s+/g, " ").toUpperCase();
}

/** Name plus postcode, or name plus our own coordinates when OSM has no postcode. */
export function textQueryForOsmVenue(venue: {
  name: string;
  address: string;
  lat: number;
  lng: number;
}): string {
  const postcode = extractUkPostcode(venue.address);
  if (postcode) return `${venue.name} ${postcode}`;
  return `${venue.name} ${venue.lat.toFixed(5)} ${venue.lng.toFixed(5)}`;
}

function normalizeGooglePlaceId(raw: string): string | null {
  const trimmed = raw.trim();
  const id = trimmed.startsWith("places/") ? trimmed.slice("places/".length) : trimmed;
  return PLACE_ID.test(id) ? id : null;
}

export function osmRefFromLayerId(id: string): string | null {
  const match = LAYER_VENUE_ID.exec(id);
  return match?.[1] ?? null;
}

/**
 * Rectangle inscribed in the match circle. Text Search IDs Only cannot return
 * coordinates, and locationRestriction on this API takes a rectangle, so every
 * accepted place is inside the circle by construction.
 */
export function matchRectangle(
  lat: number,
  lng: number,
  radiusMeters = PLACES_MATCH_RADIUS_METERS,
): {
  low: { latitude: number; longitude: number };
  high: { latitude: number; longitude: number };
} {
  const half = radiusMeters / Math.SQRT2;
  const latDelta = (half / EARTH_RADIUS_M) * (180 / Math.PI);
  const lngDelta = latDelta / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  return {
    low: { latitude: lat - latDelta, longitude: lng - lngDelta },
    high: { latitude: lat + latDelta, longitude: lng + lngDelta },
  };
}

/**
 * One distinct place id from the search rectangle matches. None, or more
 * than one, is skipped.
 */
export function decideIdOnlyPlaceMatch(placeIds: readonly string[]): IdOnlyMatch {
  const ids = new Set<string>();
  for (const raw of placeIds) {
    const id = normalizeGooglePlaceId(raw);
    if (id) ids.add(id);
  }
  if (ids.size === 0) return { outcome: "skipped", reason: "no_result" };
  if (ids.size > 1) return { outcome: "skipped", reason: "ambiguous" };
  const placeId = [...ids][0];
  if (!placeId) return { outcome: "skipped", reason: "no_result" };
  return { outcome: "matched", placeId };
}

function isClockPoint(value: unknown): value is ClockPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return (
    Number.isInteger(point.day)
    && (point.day as number) >= 0
    && (point.day as number) <= 6
    && Number.isInteger(point.hour)
    && (point.hour as number) >= 0
    && (point.hour as number) <= 24
    && Number.isInteger(point.minute)
    && (point.minute as number) >= 0
    && (point.minute as number) <= 59
  );
}

function clockText(point: ClockPoint): string | null {
  if (point.hour === 24) return point.minute === 0 ? "24:00" : null;
  if (point.hour > 23) return null;
  return `${String(point.hour).padStart(2, "0")}:${String(point.minute).padStart(2, "0")}`;
}

/**
 * Turn Places `regularOpeningHours.periods` into weekly windows for the
 * in-memory comparison. A period we cannot read rejects the whole week.
 * Closed days Google omitted stay empty. Places writes always-open as one
 * period opening Sunday 00:00 with no close.
 */
export function weeklyHoursFromPlacesPeriods(periods: unknown): WeeklyOpeningHours | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const hours: WeeklyOpeningHours = {};
  for (let day = 0; day < 7; day += 1) hours[day] = [];
  for (const period of periods) {
    if (typeof period !== "object" || period === null) return null;
    const record = period as { open?: unknown; close?: unknown };
    if (!isClockPoint(record.open)) return null;
    if (record.close === undefined) {
      const alwaysOpen = periods.length === 1
        && record.open.day === 0
        && record.open.hour === 0
        && record.open.minute === 0;
      if (!alwaysOpen) return null;
      for (let day = 0; day < 7; day += 1) hours[day] = [{ opens: "00:00", closes: "24:00" }];
      return hours;
    }
    if (!isClockPoint(record.close)) return null;
    const opens = clockText(record.open);
    const closes = clockText(record.close);
    if (!opens || !closes || opens === "24:00") return null;
    const sameDay = record.close.day === record.open.day;
    const overnight = record.close.day === (record.open.day + 1) % 7;
    if (!sameDay && !overnight) return null;
    const list = hours[record.open.day] ?? [];
    list.push({ opens, closes });
    hours[record.open.day] = list;
  }
  return hours;
}

export function pubVerificationRow(
  venueId: string,
  googlePlaceId: string,
  verifiedAt: string,
): PlacesPubVerification {
  return { venueId, googlePlaceId, verifiedAt };
}

function comparableName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

export function placesNameMatchesOsm(osmName: string, placesName: string | null): boolean {
  if (!placesName) return false;
  const ours = comparableName(osmName);
  return ours.length > 0 && ours === comparableName(placesName);
}

/** Never hide a pub on an unchecked match: a closure needs the names to agree. */
export function pubClosureVerdict(
  businessStatus: string,
  osmName: string,
  placesName: string | null,
): PubClosureVerdict {
  if (businessStatus !== "CLOSED_PERMANENTLY") return "open";
  return placesNameMatchesOsm(osmName, placesName) ? "closed" : "closed_unconfirmed";
}

function dayKey(hours: WeeklyOpeningHours, day: number): string {
  return (hours[day] ?? [])
    .map(({ opens, closes }) => `${opens}-${closes === "00:00" ? "24:00" : closes}`)
    .sort()
    .join(",");
}

/**
 * Our own verdict: does every day of the OSM week match Google's week?
 * OSM hours that are absent or that our parser cannot read are
 * `no_osm_hours`, never a disagreement.
 */
export function osmHoursVerdict(
  osmHours: WeeklyOpeningHours | null,
  placesHours: WeeklyOpeningHours,
): OsmHoursVerdict {
  if (!osmHours) return "no_osm_hours";
  for (let day = 0; day < 7; day += 1) {
    if (dayKey(osmHours, day) !== dayKey(placesHours, day)) return "disagree";
  }
  return "agree";
}

export function cafeVerificationRow(
  venueId: string,
  googlePlaceId: string,
  verdict: OsmHoursVerdict,
  verifiedAt: string,
): PlacesCafeVerification {
  return { venueId, googlePlaceId, osmHoursVerdict: verdict, verifiedAt };
}

/** USD for this job after the free monthly caps. Text Search IDs Only is free. */
export function projectedPlacesSpendUsd(input: {
  proCalls: number;
  enterpriseCalls: number;
  proAlreadyUsed?: number;
  enterpriseAlreadyUsed?: number;
}): number {
  const proBillable = Math.max(
    0,
    (input.proAlreadyUsed ?? 0) + input.proCalls - PLACE_DETAILS_PRO_FREE_MONTHLY,
  );
  const enterpriseBillable = Math.max(
    0,
    (input.enterpriseAlreadyUsed ?? 0) + input.enterpriseCalls - PLACE_DETAILS_ENTERPRISE_FREE_MONTHLY,
  );
  const usd = (
    proBillable * PLACE_DETAILS_PRO_USD_PER_THOUSAND
    + enterpriseBillable * PLACE_DETAILS_ENTERPRISE_USD_PER_THOUSAND
  ) / 1000;
  return Math.round(usd * 100) / 100;
}

const OSM_REF = /^[nwr]\d+$/;

/**
 * Curated venue ids that stand in for a closed OSM row. The base pin is
 * already dropped when that owner is on the map, so the owner id is the
 * pin the curated layer would still draw. Only an exact OSM ref qualifies.
 */
export function curatedVenueIdsForClosedOsmRefs(
  rows: readonly { osmRef: string; curatedVenueId: string }[],
  closedOsmRefs: ReadonlySet<string>,
): string[] {
  if (closedOsmRefs.size === 0) return [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!OSM_REF.test(row.osmRef) || !closedOsmRefs.has(row.osmRef)) continue;
    if (row.curatedVenueId.length === 0) continue;
    ids.add(row.curatedVenueId);
  }
  return [...ids].sort();
}

/**
 * A later run must not forget a closure it did not re-check. A ref leaves
 * only when this run name-matched an operational place, or when it is not a
 * real OSM ref. A name-matched permanent closure always stays.
 */
export function mergeClosedOsmRefs(input: {
  previous: readonly string[];
  confirmedClosed: readonly string[];
  confirmedOperational: readonly string[];
}): string[] {
  const closed = new Set(input.confirmedClosed.filter((ref) => OSM_REF.test(ref)));
  const operational = new Set(
    input.confirmedOperational.filter((ref) => OSM_REF.test(ref) && !closed.has(ref)),
  );
  const kept = new Set<string>();
  for (const ref of input.previous) {
    if (!OSM_REF.test(ref) || operational.has(ref)) continue;
    kept.add(ref);
  }
  for (const ref of closed) kept.add(ref);
  return [...kept].sort();
}

/**
 * The monthly Details usage a checkpoint resumes from. Monitoring already
 * counts this job's own attempts, sometimes late. A partial update can hide
 * foreign usage, so refuse both lagged and excess counts until the measurement
 * agrees with the checkpoint baseline plus every recorded attempt.
 */
export function resumedDetailsBaseline(input: {
  measured: number;
  checkpointPrior?: number;
  checkpointAttempts?: number;
}): number {
  if (input.checkpointPrior === undefined) return input.measured;
  if (input.measured !== input.checkpointPrior + (input.checkpointAttempts ?? 0)) {
    throw new Error("checkpoint usage differs; review spend before resuming");
  }
  return input.checkpointPrior;
}

const UNSENT_REQUEST_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * True only when fetch failed before a connection carried the request, so
 * Google cannot have counted it. Timeouts and resets stay counted.
 */
function requestNeverSent(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && UNSENT_REQUEST_CODES.has(code);
}

/**
 * Send one Places request, backing off on 429 and 503. Every attempt,
 * retries included, waits for its pacing slot and is then reserved right
 * before it is sent, so an interrupted wait records nothing. A refused
 * reservation returns null so the caller skips the venue instead of spending
 * past its cap. An attempt that never left this machine is released before
 * the error is rethrown.
 */
export async function placesRequestWithinBudget<T>(input: {
  attempts: number;
  pace: () => Promise<void>;
  reserve: () => boolean;
  release: () => void;
  send: () => Promise<{ status: number; body: T }>;
  backoff: (attempt: number) => Promise<void>;
}): Promise<T | null> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    await input.pace();
    if (!input.reserve()) return null;
    let reply: { status: number; body: T };
    try {
      reply = await input.send();
    } catch (error) {
      if (requestNeverSent(error)) input.release();
      throw error;
    }
    const { status, body } = reply;
    lastStatus = status;
    if (status === 429 || status === 503) {
      await input.backoff(attempt);
      continue;
    }
    if (status < 200 || status >= 300) throw new Error(`Places HTTP ${status}`);
    return body;
  }
  throw new Error(`Places HTTP ${lastStatus || 429}`);
}

/**
 * Put the daily overrides back, and only report success once both effective
 * limits match the values read at the start. A failed attempt leaves the
 * caller free to try again.
 */
export async function restoreQuotasUntilVerified(input: {
  attempts: number;
  expectedSearch: string;
  expectedDetails: string;
  attempt: () => Promise<{ search: string; details: string }>;
}): Promise<{ search: string; details: string }> {
  let lastError: unknown = new Error("quota restore failed");
  const attempts = Math.max(1, input.attempts);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const actual = await input.attempt();
      if (actual.search === input.expectedSearch && actual.details === input.expectedDetails) {
        return actual;
      }
      lastError = new Error(
        `quota restore mismatch search=${actual.search} details=${actual.details}`,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
