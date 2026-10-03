/**
 * Verify London OSM pubs and the Shoreditch coffee-box cafes with Places.
 *
 * Text Search is IDs only (free). Place Details then reads businessStatus
 * and displayName for pubs and, for those cafes, the opening period list.
 * The name and the periods are compared in memory with our OSM row and
 * dropped. A pub counts as closed only when Google says CLOSED_PERMANENTLY
 * and the names match; closed_pubs.json is the single record of closure.
 * The files this writes store our venue id, the place id, our cafe
 * OSM-hours verdict (agree, disagree or no_osm_hours), closed OSM refs, and
 * the day. Nothing else Google returned is written. Closures, unconfirmed
 * closures and cafes whose OSM hours disagree are printed for human review.
 *
 * Daily quota overrides are raised for this process and put back to the
 * values read at the start. The job stops before any paid call when the
 * projected USD passes the per-job cap.
 *
 *   GOOGLE_PLACES_API_KEY must already be in the environment.
 *   node --import tsx scripts/verify_london_places.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  decideIdOnlyPlaceMatch,
  isInShoreditchCoffeeBox,
  matchRectangle,
  OSM_HOURS_VERDICTS,
  osmHoursVerdict,
  pubClosureVerdict,
  projectedPlacesSpendUsd,
  pubVerificationRow,
  textQueryForOsmVenue,
  weeklyHoursFromPlacesPeriods,
} from "../lib/placesVerification.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data", "places_verification");
const DESK_PACK_PATH = join(ROOT, "public", "data", "london_desks", "desks.json");
const PROGRESS_PATH = join(OUT_DIR, "progress.json");
const PROJECT = "projects/590118888791";
const SERVICE = `${PROJECT}/services/places.googleapis.com`;
const SEARCH_METRIC = "places.googleapis.com/SearchTextRequest";
const DETAILS_METRIC = "places.googleapis.com/GetPlaceRequest";
const DAILY_UNIT = "1/d/{project}";
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

function accessToken() {
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function apiJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 180) };
    }
  }
  if (!response.ok) {
    const message = body.error?.message ?? body.raw ?? `HTTP ${response.status}`;
    throw new Error(`serviceusage ${response.status}: ${message}`);
  }
  return body;
}

function limitUrl(metric) {
  return `https://serviceusage.googleapis.com/v1beta1/${SERVICE}/consumerQuotaMetrics/${encodeURIComponent(metric)}/limits/%2Fd%2Fproject`;
}

async function dailyOverrideValue(token, metric) {
  const body = await apiJson(`${limitUrl(metric)}/consumerOverrides`, token);
  const override = (body.overrides ?? [])[0];
  if (!override?.overrideValue) {
    throw new Error(`missing daily override for ${metric}`);
  }
  return override.overrideValue;
}

async function effectiveDailyLimit(token, metric) {
  const body = await apiJson(limitUrl(metric), token);
  const bucket = (body.quotaBuckets ?? [])[0];
  return bucket?.effectiveLimit ?? null;
}

async function waitOperation(token, operation) {
  let current = operation;
  for (let attempt = 0; attempt < 30 && !current.done; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = await apiJson(
      `https://serviceusage.googleapis.com/v1beta1/${current.name}`,
      token,
    );
  }
  if (!current.done) throw new Error("quota override operation timed out");
  if (current.error) throw new Error(`quota override failed: ${current.error.message ?? "unknown"}`);
}

async function setDailyOverrides(token, searchValue, detailsValue) {
  const operation = await apiJson(
    `https://serviceusage.googleapis.com/v1beta1/${SERVICE}/consumerQuotaMetrics:importConsumerOverrides`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        force: true,
        inlineSource: {
          overrides: [
            { metric: SEARCH_METRIC, unit: DAILY_UNIT, overrideValue: String(searchValue) },
            { metric: DETAILS_METRIC, unit: DAILY_UNIT, overrideValue: String(detailsValue) },
          ],
        },
      }),
      headers: { "X-Goog-Request-Reason": "london-osm-places-verify" },
    },
  );
  if (operation.name) await waitOperation(token, operation);
}

async function monthPlacesRequests(token) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const params = new URLSearchParams({
    filter: 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.labels.service="places.googleapis.com"',
    "interval.startTime": start.toISOString(),
    "interval.endTime": new Date().toISOString(),
    "aggregation.alignmentPeriod": "2678400s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
  });
  const body = await apiJson(
    `https://monitoring.googleapis.com/v3/projects/pubmaxx/timeSeries?${params}`,
    token,
  );
  let total = 0;
  for (const series of body.timeSeries ?? []) {
    for (const point of series.points ?? []) {
      total += Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0);
    }
  }
  return total;
}

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
  };
}

function saveProgress(progress) {
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
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await pace();
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      signal: AbortSignal.timeout(20_000),
    });
    lastStatus = response.status;
    if (response.status === 429 || response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Places HTTP ${response.status}`);
    }
    return body;
  }
  throw new Error(`Places HTTP ${lastStatus || 429}`);
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
  return readDetailsBody(body, fieldMask);
}

function cafeDetail(read, osmHours) {
  if (read.status === "CLOSED_PERMANENTLY") return { skipped: "closed_permanently" };
  const placesHours = weeklyHoursFromPlacesPeriods(read.periods);
  if (!placesHours) return { skipped: "hours_unreadable" };
  return { osmHoursVerdict: osmHoursVerdict(osmHours, placesHours) };
}

function collectPub(venue, progress, day, pubs, closedRefs, pubsForReview) {
  const detail = progress.details[venue.id];
  const search = progress.searches[venue.id];
  if (!detail || detail.skipped || !search || search.outcome !== "matched") return;
  if (!["open", "closed", "closed_unconfirmed"].includes(detail.closure)) return;
  pubs.push(pubVerificationRow(venue.id, search.placeId, day));
  if (detail.closure === "closed") {
    closedRefs.push(venue.osmRef);
    pubsForReview.push(`${venue.id} ${venue.name}, ${venue.address}: closed, hidden from the map`);
  } else if (detail.closure === "closed_unconfirmed") {
    pubsForReview.push(`${venue.id} ${venue.name}, ${venue.address}: Google says closed but the name differs; not hidden`);
  }
}

function collectCafe(venue, progress, day, cafes, cafesForReview) {
  const detail = progress.details[venue.id];
  const search = progress.searches[venue.id];
  if (detail?.skipped === "closed_permanently") {
    cafesForReview.push(`${venue.id} ${venue.name}: Google marks it permanently closed`);
  }
  if (!detail || detail.skipped || !search || search.outcome !== "matched") return;
  if (!OSM_HOURS_VERDICTS.includes(detail.osmHoursVerdict)) return;
  cafes.push(cafeVerificationRow(venue.id, search.placeId, detail.osmHoursVerdict, day));
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

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY is required");
    process.exit(1);
  }

  const venues = loadVenues();
  if (venues.pubs.length !== EXPECTED_PUBS || venues.cafes.length !== EXPECTED_CAFES) {
    console.error(
      `expected ${EXPECTED_PUBS} pubs and ${EXPECTED_CAFES} cafes, found ${venues.pubs.length} and ${venues.cafes.length}`,
    );
    process.exit(1);
  }

  const token = accessToken();
  let alreadyUsed = 0;
  try {
    alreadyUsed = await monthPlacesRequests(token);
  } catch (error) {
    console.error(`could not read month-to-date Places usage: ${error.message}`);
    process.exit(1);
  }

  const worstCase = projectedPlacesSpendUsd({
    proCalls: venues.pubs.length,
    enterpriseCalls: venues.cafes.length,
    proAlreadyUsed: alreadyUsed,
    enterpriseAlreadyUsed: alreadyUsed,
  });
  console.log(
    `projected spend USD ${worstCase} for up to ${venues.pubs.length} Place Details Pro and ${venues.cafes.length} Enterprise (month-to-date Places requests ${alreadyUsed}; IDs-only Text Search is free)`,
  );
  if (worstCase > PLACES_VERIFY_JOB_CAP_USD) {
    console.error(`projected spend USD ${worstCase} passes the USD ${PLACES_VERIFY_JOB_CAP_USD} job cap; no Places calls made`);
    process.exit(2);
  }

  const originalSearch = await dailyOverrideValue(token, SEARCH_METRIC);
  const originalDetails = await dailyOverrideValue(token, DETAILS_METRIC);
  const progress = loadProgress();
  const pendingSearch = [...venues.pubs, ...venues.cafes].filter((venue) => !progress.searches[venue.id]).length;
  const searchCap = Math.max(Number(originalSearch), pendingSearch + alreadyUsed);
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
    restoreNeeded = false;
    const fresh = accessToken();
    await setDailyOverrides(fresh, originalSearch, originalDetails);
    const searchNow = await effectiveDailyLimit(fresh, SEARCH_METRIC);
    const detailsNow = await effectiveDailyLimit(fresh, DETAILS_METRIC);
    if (searchNow !== originalSearch || detailsNow !== originalDetails) {
      throw new Error(`quota restore mismatch search=${searchNow} details=${detailsNow}`);
    }
    console.log(`restored daily quotas SearchTextRequest=${searchNow} GetPlaceRequest=${detailsNow}`);
  };
  process.on("SIGINT", () => {
    restore().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    restore().finally(() => process.exit(143));
  });

  try {
    restoreNeeded = true;
    await setDailyOverrides(token, searchCap, detailsCap);
    const raisedSearch = await effectiveDailyLimit(token, SEARCH_METRIC);
    const raisedDetails = await effectiveDailyLimit(token, DETAILS_METRIC);
    if (raisedSearch !== String(searchCap) || raisedDetails !== String(detailsCap)) {
      throw new Error(`quota raise mismatch search=${raisedSearch} details=${raisedDetails}`);
    }

    const all = [...venues.pubs, ...venues.cafes];
    let searched = 0;
    for (const venue of all) {
      if (progress.searches[venue.id]) continue;
      progress.searches[venue.id] = await searchVenue(apiKey, venue);
      searched += 1;
      if (searched % 100 === 0) {
        saveProgress(progress);
        console.log(`text search ${searched}/${pendingSearch}`);
      }
    }
    saveProgress(progress);

    const matched = all.filter((venue) => progress.searches[venue.id]?.outcome === "matched");
    const pubMatches = matched.filter((venue) => venue.kind === "pub").length;
    const cafeMatches = matched.filter((venue) => venue.kind === "cafe").length;
    const detailsSpend = projectedPlacesSpendUsd({
      proCalls: pubMatches,
      enterpriseCalls: cafeMatches,
      proAlreadyUsed: alreadyUsed,
      enterpriseAlreadyUsed: alreadyUsed,
    });
    console.log(
      `matched ${pubMatches} pubs and ${cafeMatches} cafes; Place Details projected USD ${detailsSpend}`,
    );
    if (detailsSpend > PLACES_VERIFY_JOB_CAP_USD) {
      const overCap = new Error(
        `projected spend USD ${detailsSpend} passes the USD ${PLACES_VERIFY_JOB_CAP_USD} job cap; no Place Details calls made`,
      );
      overCap.code = 2;
      throw overCap;
    }

    let detailed = 0;
    for (const venue of matched) {
      if (progress.details[venue.id]) continue;
      const placeId = progress.searches[venue.id].placeId;
      const fieldMask = venue.kind === "cafe" ? PLACES_CAFE_DETAILS_FIELD_MASK : PLACES_PUB_DETAILS_FIELD_MASK;
      const read = await readDetails(apiKey, placeId, fieldMask);
      if (!read.status) {
        progress.details[venue.id] = { skipped: "unknown_status" };
      } else if (venue.kind === "pub") {
        progress.details[venue.id] = { closure: pubClosureVerdict(read.status, venue.name, read.name) };
      } else {
        progress.details[venue.id] = cafeDetail(read, venue.osmHours);
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
      collectPub(venue, progress, day, pubs, closedRefs, pubsForReview);
    }
    for (const venue of venues.cafes) {
      collectCafe(venue, progress, day, cafes, cafesForReview);
    }
    pubs.sort((a, b) => a.venueId.localeCompare(b.venueId));
    cafes.sort((a, b) => a.venueId.localeCompare(b.venueId));
    closedRefs.sort();

    const skippedNoResult = all.filter((venue) => progress.searches[venue.id]?.reason === "no_result").length;
    const skippedAmbiguous = all.filter((venue) => progress.searches[venue.id]?.reason === "ambiguous").length;
    const proCalls = venues.pubs.filter((venue) => progress.details[venue.id]).length;
    const enterpriseCalls = venues.cafes.filter((venue) => progress.details[venue.id]).length;

    writeJson(join(OUT_DIR, "london.json"), {
      version: 1,
      verifiedAt: day,
      radiusMeters: PLACES_MATCH_RADIUS_METERS,
      spend: {
        capUsd: PLACES_VERIFY_JOB_CAP_USD,
        monthToDatePlacesRequests: alreadyUsed,
        projectedUsd: projectedPlacesSpendUsd({
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
            projectedUsd: projectedPlacesSpendUsd({
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
            projectedUsd: projectedPlacesSpendUsd({
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
      },
      pubs,
    });
    writeJson(join(OUT_DIR, "closed_pubs.json"), { verifiedAt: day, osmRefs: closedRefs });
    writeJson(join(OUT_DIR, "shoreditch_cafes.json"), { verifiedAt: day, rows: cafes });
    if (existsSync(PROGRESS_PATH)) unlinkSync(PROGRESS_PATH);
    console.log(
      `wrote verification: ${pubs.length} pubs, ${cafes.length} cafes, ${closedRefs.length} permanently closed`,
    );
    pubsForReview.sort();
    console.log(`pubs for human review (${pubsForReview.length}):`);
    for (const line of pubsForReview) console.log(`  ${line}`);
    cafesForReview.sort();
    console.log(`cafes for human review (${cafesForReview.length}):`);
    for (const line of cafesForReview) console.log(`  ${line}`);
  } finally {
    await restore();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "places verify failed");
  process.exit(error instanceof Error && error.code === 2 ? 2 : 1);
});
