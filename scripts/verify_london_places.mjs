/**
 * Verify London venues or budget-selected UK city pubs with Places.
 *
 * Text Search is IDs only (free). Place Details then reads businessStatus
 * and displayName for pubs and, for the Shoreditch coffee-box cafes, the
 * opening period list. The name and the periods are compared in memory with
 * our OSM row and dropped. A pub counts as closed only when Google says CLOSED_PERMANENTLY
 * and the names match; closed_pubs.json is the single record of closure.
 * The files this writes store our venue id, the place id, our cafe
 * OSM-hours verdict (agree, disagree or no_osm_hours), closed OSM refs, the
 * run day, and on each row the UTC day its Place Details were read, kept in
 * progress.json across resumed runs (a saved verdict without a valid day is
 * read again). Nothing else Google returned is written. Closures, unconfirmed
 * closures and cafes whose OSM hours disagree are printed for human review.
 *
 * Daily quota overrides are raised for this process and put back to the
 * values read at the start. The job stops before any paid call when the
 * projected USD passes the per-job cap.
 *
 *   GOOGLE_PLACES_API_KEY must already be in the environment.
 *   node --import tsx scripts/verify_london_places.mjs
 *   node --import tsx scripts/verify_london_places.mjs --uk-cities --dry-run
 *   node --import tsx scripts/verify_london_places.mjs --uk-cities
 */

import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CITY_BOUNDS } from "../lib/cityBounds.mjs";

import { londonVenueIdFor } from "../lib/londonVenueShards.ts";
import { parseOsmOpeningHours } from "../lib/nearDesk.ts";
import {
  PLACE_DETAILS_ENTERPRISE_FREE_MONTHLY,
  PLACE_DETAILS_ENTERPRISE_USD_PER_THOUSAND,
  PLACE_DETAILS_PRO_FREE_MONTHLY,
  PLACE_DETAILS_PRO_USD_PER_THOUSAND,
  PLACES_CAFE_DETAILS_FIELD_MASK,
  PLACES_MATCH_RADIUS_METERS,
  PLACES_PUB_DETAILS_FIELD_MASK,
  PLACES_TEXT_SEARCH_FIELD_MASK,
  PLACES_VERIFY_JOB_CAP_USD,
  cafeVerificationRow,
  curatedVenueIdsForClosedOsmRefs,
  decideIdOnlyPlaceMatch,
  isInShoreditchCoffeeBox,
  matchRectangle,
  mergeClosedOsmRefs,
  OSM_HOURS_VERDICTS,
  osmHoursVerdict,
  placesNameMatchesOsm,
  pubClosureVerdict,
  projectedPlacesSpendUsd,
  placesRequestWithinBudget,
  pubVerificationRow,
  restoreQuotasUntilVerified,
  resumedDetailsBaseline,
  textQueryForOsmVenue,
  weeklyHoursFromPlacesPeriods,
} from "../lib/placesVerification.ts";
import {
  accessToken,
  dailyOverrideValue,
  DETAILS_METRIC,
  effectiveDailyLimit,
  monthPlacesRequests,
  SEARCH_METRIC,
  setDailyOverrides,
} from "./lib/googlePlacesQuota.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data", "places_verification");
const DESK_PACK_PATH = join(ROOT, "public", "data", "london_desks", "desks.json");
const UK_CITIES = process.argv.includes("--uk-cities");
const DRY_RUN = process.argv.includes("--dry-run");
const JOB_CAP_USD = UK_CITIES ? 40 : PLACES_VERIFY_JOB_CAP_USD;
const PROGRESS_PATH = join(OUT_DIR, UK_CITIES ? "uk_progress.json" : "progress.json");
let detailAttempts = 0;
let priorDetails = 0;
let activeProgress = null;
const REQUEST_REASON = "london-osm-places-verify";
const EXPECTED_PUBS = 3650;
const EXPECTED_CAFES = 61;
const PACE_MS = 150;
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const KNOWN_STATUS = new Set([
  "OPERATIONAL",
  "CLOSED_TEMPORARILY",
  "CLOSED_PERMANENTLY",
  "FUTURE_OPENING",
]);


function walkShards(dir, venues) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name.endsWith(".json")) {
      const body = JSON.parse(readFileSync(path, "utf8"));
      for (const row of body.venues ?? []) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const [osmRef, venueName, address, lat, lng, kind] = row;
        if (typeof osmRef !== "string" || typeof venueName !== "string" || !venueName) continue;
        if (typeof lat !== "number" || typeof lng !== "number") continue;
        const venue = {
          id: londonVenueIdFor(osmRef),
          osmRef,
          name: venueName,
          address: typeof address === "string" ? address : "",
          lat,
          lng,
          kind,
        };
        if (kind === "pub") venues.pubs.push(venue);
        else if (kind === "cafe" && isInShoreditchCoffeeBox(lat, lng)) venues.cafes.push(venue);
      }
    } else {
      walkShards(path, venues);
    }
  }
}

function osmHoursByRef() {
  const body = JSON.parse(readFileSync(DESK_PACK_PATH, "utf8"));
  const hours = new Map();
  for (const row of body.venues ?? []) {
    if (Array.isArray(row) && typeof row[0] === "string" && typeof row[8] === "string") {
      hours.set(row[0], row[8]);
    }
  }
  return hours;
}

function previousClosedRefs() {
  const path = join(OUT_DIR, "closed_pubs.json");
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed.osmRefs) ? parsed.osmRefs : [];
}

function confirmedClosureRefs(pubs, progress) {
  const confirmedClosed = [];
  const confirmedOperational = [];
  for (const venue of pubs) {
    const detail = progress.details[venue.id];
    if (!detail || detail.skipped) continue;
    if (detail.closure === "closed") confirmedClosed.push(venue.osmRef);
    else if (detail.closure === "open" && detail.nameMatched === true && detail.operational === true) {
      confirmedOperational.push(venue.osmRef);
    }
  }
  return { confirmedClosed, confirmedOperational };
}

function curatedOwnersForClosedRefs(closedRefs) {
  if (closedRefs.length === 0) return [];
  const wanted = new Set(closedRefs);
  const rows = [];
  const root = join(ROOT, "public", "data", "uk_base", "packs");
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name.endsWith(".json")) {
        const body = JSON.parse(readFileSync(path, "utf8"));
        for (const row of body.pubs ?? []) {
          if (!Array.isArray(row) || row.length < 6) continue;
          const osmRef = row[0];
          const curatedVenueId = row[5];
          if (typeof osmRef !== "string" || !wanted.has(osmRef)) continue;
          if (typeof curatedVenueId !== "string") continue;
          rows.push({ osmRef, curatedVenueId });
        }
      } else {
        visit(path);
      }
    }
  };
  if (existsSync(root)) visit(root);
  return curatedVenueIdsForClosedOsmRefs(rows, wanted);
}

// Captain order first. Additional cities use the locality stated by OSM.
const UK_CITY_ORDER = [
  "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Leeds", "Bristol", "Liverpool",
  "Sheffield", "Bradford", "Nottingham", "Leicester", "Coventry", "Cardiff",
  "Belfast", "Newcastle upon Tyne", "Southampton", "Portsmouth", "Hull",
  "Stoke-on-Trent", "Derby", "Swansea", "Plymouth", "Aberdeen", "Dundee",
  "Brighton", "Reading", "Luton", "Wolverhampton", "Milton Keynes", "Northampton",
  "Norwich", "York", "Peterborough", "Oxford", "Cambridge", "Exeter", "Newport",
  "Preston", "Sunderland", "Salford", "Bolton", "Blackpool", "Ipswich", "Swindon",
  "Wakefield", "Huddersfield", "Warrington", "Chester", "Lincoln", "Bath",
];

function ukJobSpend(calls, used) {
  const freeRemaining = Math.max(0, PLACE_DETAILS_PRO_FREE_MONTHLY - used);
  return Math.max(0, calls - freeRemaining) * PLACE_DETAILS_PRO_USD_PER_THOUSAND / 1000;
}

function ukBudgetExhausted() {
  return ukJobSpend(detailAttempts + 1, priorDetails) > JOB_CAP_USD;
}

function loadUkCityVenues(used, skippedSearches = 0) {
  const body = JSON.parse(readFileSync(join(ROOT, "data/osm/uk/uk_osm_pubs.json"), "utf8"));
  const pubs = [];
  const cities = [];
  const seen = new Set();
  const maxCalls = Math.max(0, PLACE_DETAILS_PRO_FREE_MONTHLY - used)
    + Math.floor(JOB_CAP_USD * 1000 / PLACE_DETAILS_PRO_USD_PER_THOUSAND) + skippedSearches;
  for (const name of UK_CITY_ORDER) {
    const id = name.toLowerCase().replaceAll(" ", "-");
    const bounds = CITY_BOUNDS[id] ?? null;
    const candidates = body.pubs.filter((pub) => {
      if (!pub.name || !Number.isFinite(pub.lat) || !Number.isFinite(pub.lng)) return false;
      if (seen.has(pub.osmId)) return false;
      // Never sweep London into a later locality pass.
      const london = CITY_BOUNDS.london;
      if (pub.lat >= london.latMin && pub.lat <= london.latMax
        && pub.lng >= london.lonMin && pub.lng <= london.lonMax) return false;
      return pub.locality?.toLowerCase() === name.toLowerCase() || (bounds
        && pub.lat >= bounds.latMin && pub.lat <= bounds.latMax
        && pub.lng >= bounds.lonMin && pub.lng <= bounds.lonMax);
    }).sort((a, b) => a.osmId.localeCompare(b.osmId));
    const chosen = candidates.slice(0, Math.max(0, maxCalls - pubs.length));
    if (chosen.length === 0) continue;
    cities.push({ id, name, scope: bounds ? "OSM locality or city box" : "OSM locality only",
      bounds, available: candidates.length, selected: chosen.length });
    for (const pub of chosen) {
      seen.add(pub.osmId);
      const osmRef = pub.osmId.replace(/^(node|way|relation)\//, (_, kind) => kind[0]);
      pubs.push({ id: `venue-uk-${osmRef}`, osmRef, name: pub.name,
        address: pub.address ?? "", lat: pub.lat, lng: pub.lng, kind: "pub", city: id });
    }
    if (pubs.length === maxCalls) break;
  }
  return { pubs, cafes: [], cities };
}

function loadVenues() {
  const venues = { pubs: [], cafes: [] };
  walkShards(join(ROOT, "public", "data", "london_venues", "packs"), venues);
  const hours = osmHoursByRef();
  for (const cafe of venues.cafes) {
    cafe.osmHours = parseOsmOpeningHours(hours.get(cafe.osmRef));
  }
  return venues;
}

function loadProgress() {
  if (!existsSync(PROGRESS_PATH)) return { searches: {}, details: {} };
  const parsed = JSON.parse(readFileSync(PROGRESS_PATH, "utf8"));
  return {
    searches: parsed.searches ?? {},
    details: parsed.details ?? {},
    detailAttempts: parsed.detailAttempts,
    priorDetails: parsed.priorDetails,
  };
}

function saveProgress(progress) {
  if (UK_CITIES) Object.assign(progress, { detailAttempts, priorDetails });
  const temp = `${PROGRESS_PATH}.tmp`;
  writeFileSync(temp, `${JSON.stringify(progress)}\n`);
  renameSync(temp, PROGRESS_PATH);
}

function writeJson(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

let nextCallAt = 0;
async function pace() {
  const now = Date.now();
  const wait = Math.max(0, nextCallAt - now);
  nextCallAt = Math.max(now, nextCallAt) + PACE_MS;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function placesFetch(url, apiKey, fieldMask, init) {
  const metered = UK_CITIES && init?.method === "GET";
  return placesRequestWithinBudget({
    attempts: 4,
    pace,
    reserve: () => {
      if (!metered) return true;
      if (ukBudgetExhausted()) return false;
      detailAttempts += 1;
      if (activeProgress) saveProgress(activeProgress);
      return true;
    },
    release: () => {
      if (!metered) return;
      detailAttempts -= 1;
      if (activeProgress) saveProgress(activeProgress);
    },
    send: async () => {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        signal: AbortSignal.timeout(20_000),
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    },
    backoff: (attempt) => new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))),
  });
}

function idsFromSearch(body) {
  const places = Array.isArray(body.places) ? body.places : [];
  for (const place of places) {
    const extra = Object.keys(place).filter((key) => key !== "id");
    if (extra.length > 0) {
      throw new Error(`text search field mask returned ${extra.join(",")}`);
    }
  }
  return places.map((place) => (typeof place.id === "string" ? place.id : ""));
}

function readDetailsBody(body, fieldMask) {
  const allowed = new Set(fieldMask.split(",").map((part) => part.split(".")[0]));
  allowed.add("id");
  allowed.add("name");
  const extra = Object.keys(body).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw new Error(`details field mask returned ${extra.join(",")}`);
  const hours = body.regularOpeningHours;
  if (hours && typeof hours === "object") {
    const hourKeys = Object.keys(hours).filter((key) => key !== "periods");
    if (hourKeys.length > 0) throw new Error(`details field mask returned ${hourKeys.join(",")}`);
  }
  const status = body.businessStatus;
  if (typeof status !== "string" || !KNOWN_STATUS.has(status)) return { status: null, periods: null, name: null };
  const periods = hours && Array.isArray(hours.periods) ? hours.periods : null;
  const name = typeof body.displayName?.text === "string" ? body.displayName.text : null;
  return { status, periods, name };
}

async function searchVenue(apiKey, venue) {
  const body = await placesFetch(SEARCH_URL, apiKey, PLACES_TEXT_SEARCH_FIELD_MASK, {
    method: "POST",
    body: JSON.stringify({
      textQuery: textQueryForOsmVenue(venue),
      maxResultCount: 5,
      regionCode: "GB",
      locationRestriction: {
        rectangle: matchRectangle(venue.lat, venue.lng),
      },
    }),
  });
  return decideIdOnlyPlaceMatch(idsFromSearch(body));
}

async function readDetails(apiKey, placeId, fieldMask) {
  const body = await placesFetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    apiKey,
    fieldMask,
    { method: "GET" },
  );
  return body ? readDetailsBody(body, fieldMask) : null;
}

function cafeDetail(read, osmHours) {
  if (read.status === "CLOSED_PERMANENTLY") return { skipped: "closed_permanently" };
  const placesHours = weeklyHoursFromPlacesPeriods(read.periods);
  if (!placesHours) return { skipped: "hours_unreadable" };
  return { osmHoursVerdict: osmHoursVerdict(osmHours, placesHours) };
}

function collectPub(venue, progress, pubs, closedRefs, pubsForReview) {
  const detail = progress.details[venue.id];
  const search = progress.searches[venue.id];
  if (!detail || detail.skipped || !search || search.outcome !== "matched") return;
  if (!["open", "closed", "closed_unconfirmed"].includes(detail.closure)) return;
  pubs.push(pubVerificationRow(venue.id, search.placeId, detail.observedAt));
  if (detail.closure === "closed") {
    closedRefs.push(venue.osmRef);
    pubsForReview.push(`${venue.id} ${venue.name}, ${venue.address}: closed, hidden from the map`);
  } else if (detail.closure === "closed_unconfirmed") {
    pubsForReview.push(`${venue.id} ${venue.name}, ${venue.address}: Google says closed but the name differs; not hidden`);
  }
}

function collectCafe(venue, progress, cafes, cafesForReview) {
  const detail = progress.details[venue.id];
  const search = progress.searches[venue.id];
  if (detail?.skipped === "closed_permanently") {
    cafesForReview.push(`${venue.id} ${venue.name}: Google marks it permanently closed`);
  }
  if (!detail || detail.skipped || !search || search.outcome !== "matched") return;
  if (!OSM_HOURS_VERDICTS.includes(detail.osmHoursVerdict)) return;
  cafes.push(cafeVerificationRow(venue.id, search.placeId, detail.osmHoursVerdict, detail.observedAt));
  if (detail.osmHoursVerdict === "disagree") {
    cafesForReview.push(`${venue.id} ${venue.name}: OSM hours disagree with Google`);
  }
}

function cafeVerdictCounts(cafes) {
  const counts = { agree: 0, disagree: 0, no_osm_hours: 0 };
  for (const row of cafes) counts[row.osmHoursVerdict] += 1;
  return {
    cafesOsmHoursAgree: counts.agree,
    cafesOsmHoursDisagree: counts.disagree,
    cafesNoOsmHours: counts.no_osm_hours,
  };
}

function verifiedDay() {
  return new Date().toISOString().slice(0, 10);
}

function validObservationDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day && day <= verifiedDay();
}

function settledDetail(saved) {
  return Boolean(saved?.skipped || validObservationDay(saved?.observedAt));
}

async function prepareVerification() {
  const priorArg = process.argv.find((arg) => arg.startsWith("--prior-details="));
  if (priorArg && (!DRY_RUN || !UK_CITIES)) throw new Error("--prior-details is dry-run only");
  const token = priorArg ? null : accessToken();
  const measured = priorArg ? Number(priorArg.split("=")[1]) : await monthPlacesRequests(token, UK_CITIES);
  if (!Number.isSafeInteger(measured) || measured < 0) throw new Error("invalid monthly usage");
  const progress = DRY_RUN ? null : loadProgress();
  const alreadyUsed = progress ? resumedDetailsBaseline({
    measured,
    checkpointPrior: progress.priorDetails,
    checkpointAttempts: progress.detailAttempts,
  }) : measured;
  priorDetails = alreadyUsed;
  detailAttempts = progress?.detailAttempts ?? 0;
  const venues = UK_CITIES ? loadUkCityVenues(alreadyUsed) : loadVenues();
  if (!UK_CITIES && (venues.pubs.length !== EXPECTED_PUBS || venues.cafes.length !== EXPECTED_CAFES)) {
    throw new Error(`expected ${EXPECTED_PUBS} pubs and ${EXPECTED_CAFES} cafes`);
  }
  if (DRY_RUN) {
    if (!UK_CITIES) throw new Error("--dry-run requires --uk-cities");
    console.log(JSON.stringify({ mode: "dry-run", priorDetails: alreadyUsed,
      capUsd: JOB_CAP_USD, pubsConsidered: venues.pubs.length,
      projectedUsd: ukJobSpend(venues.pubs.length, alreadyUsed), cities: venues.cities }, null, 2));
    return null;
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is required");

  const worstCase = UK_CITIES ? ukJobSpend(venues.pubs.length, alreadyUsed) : projectedPlacesSpendUsd({
    proCalls: venues.pubs.length,
    enterpriseCalls: venues.cafes.length,
    proAlreadyUsed: alreadyUsed,
    enterpriseAlreadyUsed: alreadyUsed,
  });
  console.log(
    `projected spend USD ${worstCase} for up to ${venues.pubs.length} Place Details Pro and ${venues.cafes.length} Enterprise (month-to-date Places requests ${alreadyUsed}; IDs-only Text Search is free)`,
  );
  if (worstCase > JOB_CAP_USD) {
    console.error(`projected spend USD ${worstCase} passes the USD ${JOB_CAP_USD} job cap; no Places calls made`);
    process.exit(2);
  }

  return { token, alreadyUsed, venues, apiKey, progress };
}

async function searchSelectedVenues(apiKey, venues, progress, alreadyUsed) {
  const all = [...venues.pubs, ...venues.cafes];
  let searched = 0;
  while (true) {
    for (const venue of all) {
      if (progress.searches[venue.id]) continue;
      progress.searches[venue.id] = await searchVenue(apiKey, venue);
      searched += 1;
      if (searched % 100 === 0) {
        saveProgress(progress);
        console.log(`text search ${searched}, selected ${all.length}`);
      }
    }
    saveProgress(progress);
    if (!UK_CITIES) break;
    // No-match and ambiguous searches cost nothing. Give their reserved
    // Details slots to the next pubs in city order before spending them.
    const skipped = all.filter((venue) => progress.searches[venue.id]?.outcome === "skipped").length;
    const expanded = loadUkCityVenues(alreadyUsed, skipped);
    if (expanded.pubs.length <= all.length) break;
    const known = new Set(all.map((venue) => venue.id));
    all.push(...expanded.pubs.filter((venue) => !known.has(venue.id)));
    venues.pubs = expanded.pubs;
    venues.cities = expanded.cities;
  }

  return all;
}

async function main() {
  const prepared = await prepareVerification();
  if (!prepared) return;
  const { token, alreadyUsed, venues, apiKey, progress } = prepared;
  const originalSearch = await dailyOverrideValue(token, SEARCH_METRIC);
  const originalDetails = await dailyOverrideValue(token, DETAILS_METRIC);
  activeProgress = progress;
  const pendingSearch = [...venues.pubs, ...venues.cafes].filter((venue) => !progress.searches[venue.id]).length;
  const searchSlots = UK_CITIES ? loadUkCityVenues(alreadyUsed, Number.MAX_SAFE_INTEGER / 2).pubs.length : pendingSearch;
  const searchCap = Math.max(Number(originalSearch), searchSlots + alreadyUsed);
  const detailsCap = Math.max(
    Number(originalDetails),
    venues.pubs.length + venues.cafes.length + alreadyUsed,
  );
  console.log(
    `raising SearchTextRequest daily ${originalSearch} -> ${searchCap} and GetPlaceRequest daily ${originalDetails} -> ${detailsCap}`,
  );

  let restoreNeeded = false;
  const restore = async () => {
    if (!restoreNeeded) return;
    const actual = await restoreQuotasUntilVerified({
      attempts: 3,
      expectedSearch: String(originalSearch),
      expectedDetails: String(originalDetails),
      attempt: async () => {
        const fresh = accessToken();
        await setDailyOverrides(fresh, originalSearch, originalDetails, REQUEST_REASON);
        const searchNow = await effectiveDailyLimit(fresh, SEARCH_METRIC);
        const detailsNow = await effectiveDailyLimit(fresh, DETAILS_METRIC);
        return { search: String(searchNow), details: String(detailsNow) };
      },
    });
    restoreNeeded = false;
    console.log(
      `restored daily quotas SearchTextRequest=${actual.search} GetPlaceRequest=${actual.details}`,
    );
  };
  process.on("SIGINT", () => {
    if (UK_CITIES) saveProgress(progress);
    restore().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    if (UK_CITIES) saveProgress(progress);
    restore().finally(() => process.exit(143));
  });

  try {
    restoreNeeded = true;
    await setDailyOverrides(token, searchCap, detailsCap, REQUEST_REASON);
    const raisedSearch = await effectiveDailyLimit(token, SEARCH_METRIC);
    const raisedDetails = await effectiveDailyLimit(token, DETAILS_METRIC);
    if (raisedSearch !== String(searchCap) || raisedDetails !== String(detailsCap)) {
      throw new Error(`quota raise mismatch search=${raisedSearch} details=${raisedDetails}`);
    }

    const all = await searchSelectedVenues(apiKey, venues, progress, alreadyUsed);

    const matched = all.filter((venue) => progress.searches[venue.id]?.outcome === "matched");
    const pubMatches = matched.filter((venue) => venue.kind === "pub").length;
    const cafeMatches = matched.filter((venue) => venue.kind === "cafe").length;
    const detailsSpend = UK_CITIES ? ukJobSpend(pubMatches, alreadyUsed) : projectedPlacesSpendUsd({
      proCalls: pubMatches,
      enterpriseCalls: cafeMatches,
      proAlreadyUsed: alreadyUsed,
      enterpriseAlreadyUsed: alreadyUsed,
    });
    console.log(
      `matched ${pubMatches} pubs and ${cafeMatches} cafes; Place Details projected USD ${detailsSpend}`,
    );
    if (detailsSpend > JOB_CAP_USD) {
      const overCap = new Error(
        `projected spend USD ${detailsSpend} passes the USD ${JOB_CAP_USD} job cap; no Place Details calls made`,
      );
      overCap.code = 2;
      throw overCap;
    }

    if (UK_CITIES) {
      const latestUsage = await monthPlacesRequests(accessToken(), UK_CITIES);
      priorDetails = Math.max(priorDetails, latestUsage - detailAttempts);
      const refreshedSpend = ukJobSpend(pubMatches, priorDetails);
      if (refreshedSpend > JOB_CAP_USD) {
        throw new Error(`monthly usage changed: projected USD ${refreshedSpend} exceeds job cap; no new Details calls made`);
      }
    }
    let detailed = 0;
    for (const venue of matched) {
      if (settledDetail(progress.details[venue.id])) continue;
      delete progress.details[venue.id];
      const placeId = progress.searches[venue.id].placeId;
      const fieldMask = venue.kind === "cafe" ? PLACES_CAFE_DETAILS_FIELD_MASK : PLACES_PUB_DETAILS_FIELD_MASK;
      const read = await readDetails(apiKey, placeId, fieldMask);
      if (!read) {
        progress.details[venue.id] = { skipped: "budget_exhausted" };
        continue;
      }
      const observedAt = verifiedDay();
      if (!read.status) {
        progress.details[venue.id] = { skipped: "unknown_status" };
      } else if (venue.kind === "pub") {
        progress.details[venue.id] = {
          observedAt,
          closure: pubClosureVerdict(read.status, venue.name, read.name),
          nameMatched: placesNameMatchesOsm(venue.name, read.name),
          operational: read.status === "OPERATIONAL",
        };
      } else {
        const detail = cafeDetail(read, venue.osmHours);
        progress.details[venue.id] = detail.skipped ? detail : { ...detail, observedAt };
      }
      detailed += 1;
      if (detailed % 100 === 0) {
        saveProgress(progress);
        console.log(`place details ${detailed}`);
      }
    }
    saveProgress(progress);

    const day = verifiedDay();
    const pubs = [];
    const cafes = [];
    const closedRefs = [];
    const pubsForReview = [];
    const cafesForReview = [];
    for (const venue of venues.pubs) {
      collectPub(venue, progress, pubs, closedRefs, pubsForReview);
    }
    for (const venue of venues.cafes) {
      collectCafe(venue, progress, cafes, cafesForReview);
    }
    pubs.sort((a, b) => a.venueId.localeCompare(b.venueId));
    cafes.sort((a, b) => a.venueId.localeCompare(b.venueId));
    const confirmed = confirmedClosureRefs(venues.pubs, progress);
    const mergedClosedRefs = mergeClosedOsmRefs({
      previous: previousClosedRefs(),
      confirmedClosed: confirmed.confirmedClosed,
      confirmedOperational: confirmed.confirmedOperational,
    });
    const curatedVenueIds = curatedOwnersForClosedRefs(mergedClosedRefs);
    closedRefs.sort();

    const skippedNoResult = all.filter((venue) => progress.searches[venue.id]?.reason === "no_result").length;
    const skippedAmbiguous = all.filter((venue) => progress.searches[venue.id]?.reason === "ambiguous").length;
    const proCalls = UK_CITIES ? detailAttempts : venues.pubs.filter((venue) => progress.details[venue.id]).length;
    const skippedDetails = (reason) => venues.pubs.filter((venue) => progress.details[venue.id]?.skipped === reason).length;
    const enterpriseCalls = venues.cafes.filter((venue) => progress.details[venue.id]).length;

    const billingPrior = UK_CITIES ? priorDetails : alreadyUsed;
    writeJson(join(OUT_DIR, UK_CITIES ? "uk_cities.json" : "london.json"), {
      version: 1,
      verifiedAt: day,
      radiusMeters: PLACES_MATCH_RADIUS_METERS,
      spend: {
        capUsd: JOB_CAP_USD,
        ...(UK_CITIES ? { detailsAttempts: detailAttempts, actualTariffUsd: ukJobSpend(detailAttempts, billingPrior), billingPriorDetails: billingPrior, billingBasis: "request tariff estimate, not billing invoice" } : {}),
        monthToDatePlacesRequests: alreadyUsed,
        projectedUsd: UK_CITIES ? ukJobSpend(detailAttempts, billingPrior) : projectedPlacesSpendUsd({
          proCalls,
          enterpriseCalls,
          proAlreadyUsed: alreadyUsed,
          enterpriseAlreadyUsed: alreadyUsed,
        }),
        skus: [
          {
            sku: "Places API Text Search Essentials (IDs Only)",
            fieldMask: PLACES_TEXT_SEARCH_FIELD_MASK,
            calls: all.length,
            usdPerThousand: 0,
            projectedUsd: 0,
          },
          {
            sku: "Places API Place Details Pro",
            fieldMask: PLACES_PUB_DETAILS_FIELD_MASK,
            calls: proCalls,
            usdPerThousandAfterFreeCap: PLACE_DETAILS_PRO_USD_PER_THOUSAND,
            freeMonthlyCap: PLACE_DETAILS_PRO_FREE_MONTHLY,
            projectedUsd: UK_CITIES ? ukJobSpend(detailAttempts, billingPrior) : projectedPlacesSpendUsd({
              proCalls,
              enterpriseCalls: 0,
              proAlreadyUsed: alreadyUsed,
            }),
          },
          {
            sku: "Places API Place Details Enterprise",
            fieldMask: PLACES_CAFE_DETAILS_FIELD_MASK,
            calls: enterpriseCalls,
            usdPerThousandAfterFreeCap: PLACE_DETAILS_ENTERPRISE_USD_PER_THOUSAND,
            freeMonthlyCap: PLACE_DETAILS_ENTERPRISE_FREE_MONTHLY,
            projectedUsd: UK_CITIES ? 0 : projectedPlacesSpendUsd({
              proCalls: 0,
              enterpriseCalls,
              enterpriseAlreadyUsed: alreadyUsed,
            }),
          },
        ],
      },
      summary: {
        pubsConsidered: venues.pubs.length,
        cafesConsidered: venues.cafes.length,
        pubsVerified: pubs.length,
        cafesVerified: cafes.length,
        ...cafeVerdictCounts(cafes),
        skippedNoResult,
        skippedAmbiguous,
        closedPermanently: closedRefs.length,
        closedUnconfirmed: pubsForReview.length - closedRefs.length,
        ...(UK_CITIES ? {
          skippedUnknownStatus: skippedDetails("unknown_status"),
          skippedBudgetExhausted: skippedDetails("budget_exhausted"),
        } : {}),
      },
      ...(UK_CITIES ? { cities: venues.cities } : {}),
      pubs,
    });
    writeJson(join(OUT_DIR, "closed_pubs.json"), {
      verifiedAt: day,
      osmRefs: mergedClosedRefs,
      curatedVenueIds,
    });
    if (!UK_CITIES) writeJson(join(OUT_DIR, "shoreditch_cafes.json"), { verifiedAt: day, rows: cafes });
    if (existsSync(PROGRESS_PATH)) unlinkSync(PROGRESS_PATH);
    progress.completed = true;
    console.log(
      `wrote verification: ${pubs.length} pubs, ${cafes.length} cafes, ${mergedClosedRefs.length} permanently closed`,
    );
    pubsForReview.sort();
    console.log(`pubs for human review (${pubsForReview.length}):`);
    for (const line of pubsForReview) console.log(`  ${line}`);
    cafesForReview.sort();
    console.log(`cafes for human review (${cafesForReview.length}):`);
    for (const line of cafesForReview) console.log(`  ${line}`);
  } finally {
    if (UK_CITIES && !progress.completed) saveProgress(progress);
    await restore();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "places verify failed");
  process.exit(error instanceof Error && error.code === 2 ? 2 : 1);
});
