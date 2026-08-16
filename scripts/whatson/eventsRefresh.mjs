// scripts/whatson/eventsRefresh.mjs
//
// What's-On EVENTS vertical — the first live-API vertical. Unlike the music /
// deals / sport / quiz generators (pure transforms over hand-verified
// first-party data), this one ingests OFFICIAL, self-service event-listing APIs
// and normalises their payloads into the B1 WhatsOnRow contract. See
// docs/EVENT_SOURCES_RESEARCH_2026-07-18.md for the full source audit.
//
// GOVERNANCE — official APIs only, provenance non-negotiable:
//   * NO scraping of aggregators. The two wired providers are the only free,
//     self-service, legally-clean discovery APIs found (Eventbrite killed
//     public search in 2019; DICE/SeeTickets/Songkick/Bandsistown/RA are all
//     partner-gated or scraping-only).
//   * TICKETMASTER (Discovery API v2) — free, instant key. Terms require a
//     deep-link back to the event's ticketmaster page and only "reasonable
//     period" caching. We honour that by FULLY OVERWRITING events_london.json
//     on every refresh (never append-only history) and letting the store's
//     tonight-window + past-dated freshness guard (lib/whatsOn.ts filterNotPast)
//     drop expired rows — the checked-in file is only ever a short-lived
//     working cache. Every row links back to its
//     own ticketmaster.co.uk event page.
//   * SKIDDLE (Events API) — best pub/bar-scale coverage, free key, BUT the
//     API is "for non-commercial use only. Any commercial use must be first
//     approved in writing by emailing dev@skiddle.com." PUBMAXX is commercial,
//     so this provider stays noop-skipped until SKIDDLE_API_KEY is present
//     (owner must secure written approval AND a key first).
//
// KEYS / NOOP-SKIP: each provider reads its own env key
// (TICKETMASTER_API_KEY / SKIDDLE_API_KEY). A provider whose key is absent is
// SKIPPED entirely (no fetch, contributes no rows) — the owner signs up later
// and it lights up with no code change. With no keys at all, main() is a pure
// no-op that leaves the honest empty file untouched.
//
// KIND MAPPING: music and sport stay themselves. Comedy, theatre, club and
// BARPUB map onto kind "event" so a real night is not dropped. A classification
// we still cannot name (Film, DATE, …) is DROPPED and counted.
//
// VENUE MATCHING (W6): each normalised row is passed through the shared,
// conservative resolveVenueId (exact grouping-key OR normalized-name +
// postcode/proximity confirmation, null on ambiguity). Unmatched events are
// STILL LISTED with their own venue name — they just don't carry a venueId.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CITY_BOUNDS } from "../../lib/cityBounds.mjs";
import { resolveVenueId, loadCanonicalVenueIndex } from "./resolveVenueId.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const EVENT_REFRESH_CITIES = [
  "london",
  "bristol",
  "cambridge",
  "glasgow",
  "liverpool",
  "manchester",
  "oxford",
];

const LONDON = { lat: 51.5074, lng: -0.1278, radiusMiles: 30 };
// How far ahead to pull. The store re-windows to "tonight" and drops stale
// rows, so a small forward horizon keeps the cached file short-lived (honouring
// Ticketmaster's "reasonable period" caching term) while surviving a missed run.
const FORWARD_HORIZON_MS = 2 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Source descriptors + attribution
// ---------------------------------------------------------------------------

// Ticketmaster: every row's source links back to the event's own TM page (the
// deep-link-back the Discovery API terms require). See research doc §1 — the
// exact "Powered by Ticketmaster" branding-guide string is unverified; the
// "via Ticketmaster" label + deep link satisfies the attribution we can
// confirm. Confirm the branding guide before public launch.
export const TICKETMASTER_SOURCE = {
  label: "Ticketmaster",
  url: "https://www.ticketmaster.co.uk/",
};

// Skiddle: rows link back to the event's own skiddle.com page (their affiliate
// / display expectation). See research doc §3 — commercial use requires written
// approval; this provider is gated behind SKIDDLE_API_KEY.
export const SKIDDLE_SOURCE = {
  label: "Skiddle",
  url: "https://www.skiddle.com/",
};

// Music and sport keep their own kinds. Comedy / theatre / club / BARPUB land
// on "event". Anything else is dropped and counted.
export const TICKETMASTER_SEGMENT_KIND = {
  Music: "music",
  Sports: "sport",
  "Arts & Theatre": "event",
  Comedy: "event",
};

export const SKIDDLE_EVENTCODE_KIND = {
  LIVE: "music",
  FEST: "music",
  SPORT: "sport",
  CLUB: "event",
  COMEDY: "event",
  THEATRE: "event",
  BARPUB: "event",
};

export const EMPTY_EVENT_DROPS = Object.freeze({
  noKind: 0,
  noPlace: 0,
  noStart: 0,
  noUrl: 0,
  noTitle: 0,
  total: 0,
});

export function emptyEventDrops() {
  return { noKind: 0, noPlace: 0, noStart: 0, noUrl: 0, noTitle: 0, total: 0 };
}

function noteDrop(dropped, reason) {
  dropped[reason] += 1;
  dropped.total += 1;
}

export function summariseEventDrops(dropped) {
  if (!dropped || dropped.total === 0) return "dropped 0";
  return `dropped ${dropped.total} (noKind=${dropped.noKind} noPlace=${dropped.noPlace} noStart=${dropped.noStart} noUrl=${dropped.noUrl} noTitle=${dropped.noTitle})`;
}

export function providerLaneStatus(env = process.env) {
  const present = (name) => {
    const value = env?.[name];
    return typeof value === "string" && value.trim().length > 0;
  };
  return {
    ticketmaster: present("TICKETMASTER_API_KEY") ? "configured" : "not-configured",
    skiddle: present("SKIDDLE_API_KEY") ? "configured" : "not-configured",
  };
}

export function eventsOutputPath(city = "london") {
  return join(ROOT, "public", "data", "whats_on", `events_${city}.json`);
}

export function dedupeEventRowsBySourceId(rows) {
  const byKey = new Map();
  const leftover = [];
  for (const row of rows) {
    if (!nonEmptyString(row?.sourceId) || !nonEmptyString(row?.source?.label)) {
      leftover.push(row);
      continue;
    }
    const key = `${row.source.label.toLowerCase()}|${row.sourceId}`;
    const existing = byKey.get(key);
    if (!existing || Date.parse(row.observedAt) >= Date.parse(existing.observedAt)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values(), ...leftover];
}

// ---------------------------------------------------------------------------
// Time helpers (pure)
// ---------------------------------------------------------------------------

// Europe/London UTC offset (ms) at an absolute instant. +3600000 in BST, 0 in
// GMT. Mirrors lib/whatsOn.ts londonOffsetMs but self-contained for the script.
function londonOffsetMsAt(instantMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

// Turn a value into a clean absolute ISO string, or null. Accepts a
// tz-qualified ISO (used as-is) OR a bare "YYYY-MM-DD HH:MM:SS" / "…THH:MM:SS"
// wall-clock time, which is interpreted in Europe/London (what Skiddle and
// Ticketmaster localDate/localTime return).
export function toIsoInstant(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  // Already carries a timezone (Z or ±hh:mm) — trust it.
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (!Number.isFinite(asUtc)) return null;
  const offset = londonOffsetMsAt(asUtc);
  return new Date(asUtc - offset).toISOString();
}

// FNV-1a stable id (matches the spine's stableId flavour in lib/whatsOn.ts).
function stableId(prefix, input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function httpUrl(value) {
  if (!nonEmptyString(value)) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}

function finiteNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Parse a leading GBP amount out of a free-text price ("£10", "10.50", "Free").
function parseGbp(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (!nonEmptyString(value)) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(value.replace(/[,]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function attachVenue(row, venueMatch, venueIndex) {
  if (!venueIndex) return row;
  const resolved = resolveVenueId(venueMatch, venueIndex);
  if (resolved) row.venueId = resolved;
  return row;
}

// ---------------------------------------------------------------------------
// Ticketmaster normalisation (pure)
// ---------------------------------------------------------------------------

// The point + radius a provider aims at for one city, derived from the shared
// bounds table so the build-time refresh and the request-time /api/out seams
// cannot aim at two different centres. Turning a city on is data, not code.
export function cityGeo(city = "london") {
  const bounds = CITY_BOUNDS[city];
  if (!bounds) return { ...LONDON };
  const lat = (bounds.latMin + bounds.latMax) / 2;
  const lng = (bounds.lonMin + bounds.lonMax) / 2;
  const latMiles = ((bounds.latMax - bounds.latMin) * 69) / 2;
  const lonMiles =
    ((bounds.lonMax - bounds.lonMin) * 69 * Math.cos((lat * Math.PI) / 180)) / 2;
  return { lat, lng, radiusMiles: Math.max(5, Math.ceil(Math.hypot(latMiles, lonMiles))) };
}

function firstImageUrl(images) {
  if (!Array.isArray(images)) return null;
  for (const image of images) {
    const url = httpUrl(image?.url);
    if (url) return url;
  }
  return null;
}

function asSourceId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (nonEmptyString(value)) return value.trim();
  return null;
}

// First mapping kind across an event's classifications, or undefined.
function ticketmasterKind(classifications) {
  for (const c of classifications) {
    const seg = c?.segment?.name;
    if (nonEmptyString(seg) && TICKETMASTER_SEGMENT_KIND[seg]) return TICKETMASTER_SEGMENT_KIND[seg];
  }
  return undefined;
}

// dates.start.dateTime (tz-qualified) or localDate+localTime (London wall).
function ticketmasterStart(start) {
  const fromDateTime = toIsoInstant(start?.dateTime);
  if (fromDateTime) return fromDateTime;
  if (nonEmptyString(start?.localDate) && nonEmptyString(start?.localTime)) {
    return toIsoInstant(`${start.localDate} ${start.localTime}`);
  }
  return null;
}

// Map one Discovery API v2 event object to a WhatsOnRow, or null if it can't be
// honestly represented (no mapping kind, no place name, no start, no link).
function classifyTicketmasterEvent(event, { observedAt, venueIndex = null } = {}) {
  if (!event || typeof event !== "object") return { row: null, drop: "noTitle" };

  const classifications = Array.isArray(event.classifications) ? event.classifications : [];
  const kind = ticketmasterKind(classifications);
  if (!kind) return { row: null, drop: "noKind" };

  const venue = event._embedded?.venues?.[0];
  const placeName = venue?.name;
  if (!nonEmptyString(placeName)) return { row: null, drop: "noPlace" };

  const url = httpUrl(event.url);
  if (!url) return { row: null, drop: "noUrl" };

  const title = nonEmptyString(event.name) ? event.name.trim() : null;
  if (!title) return { row: null, drop: "noTitle" };

  const startsAt = ticketmasterStart(event.dates?.start);
  if (!startsAt) return { row: null, drop: "noStart" };

  const row = {
    id: stableId("events-tm", `${event.id ?? title}|${placeName}|${startsAt}`),
    placeName: placeName.trim(),
    kind,
    startsAt,
    title,
    source: { ...TICKETMASTER_SOURCE, url },
    observedAt,
    confidence: "listed",
  };

  const sourceId = asSourceId(event.id);
  if (sourceId) row.sourceId = sourceId;
  const imageUrl = firstImageUrl(event.images);
  if (imageUrl) row.imageUrl = imageUrl;

  const lat = finiteNum(venue?.location?.latitude);
  const lng = finiteNum(venue?.location?.longitude);
  if (lat !== null) row.lat = lat;
  if (lng !== null) row.lng = lng;

  const price = event.priceRanges?.find((p) => p?.currency === "GBP");
  const gbp = parseGbp(price?.min);
  if (gbp !== null) row.priceGbp = gbp;

  const genre = classifications.find((c) => nonEmptyString(c?.genre?.name))?.genre?.name;
  if (nonEmptyString(genre)) row.detail = genre.trim();

  return {
    row: attachVenue(row, {
      name: placeName,
      address: venue?.address?.line1 ?? "",
      postcode: venue?.postalCode ?? "",
      lat,
      lng,
    }, venueIndex),
    drop: null,
  };
}

export function mapTicketmasterEvent(event, opts = {}) {
  return classifyTicketmasterEvent(event, opts).row;
}

export function normaliseTicketmasterEvents(payload, opts = {}) {
  const dropped = emptyEventDrops();
  const events = payload?._embedded?.events;
  if (!Array.isArray(events)) return { rows: [], dropped };
  const rows = [];
  for (const event of events) {
    const { row, drop } = classifyTicketmasterEvent(event, opts);
    if (row) rows.push(row);
    else if (drop) noteDrop(dropped, drop);
  }
  return { rows, dropped };
}

// ---------------------------------------------------------------------------
// Skiddle normalisation (pure)
// ---------------------------------------------------------------------------

// Map one Skiddle Events-API result to a WhatsOnRow, or null.
function classifySkiddleEvent(event, { observedAt, venueIndex = null } = {}) {
  if (!event || typeof event !== "object") return { row: null, drop: "noTitle" };

  const code = event.EventCode ?? event.eventcode;
  const kind = nonEmptyString(code) ? SKIDDLE_EVENTCODE_KIND[code] : undefined;
  if (!kind) return { row: null, drop: "noKind" };

  const venue = event.venue ?? {};
  const placeName = venue.name;
  if (!nonEmptyString(placeName)) return { row: null, drop: "noPlace" };

  const url = httpUrl(event.link);
  if (!url) return { row: null, drop: "noUrl" };

  const title = nonEmptyString(event.eventname) ? event.eventname.trim() : null;
  if (!title) return { row: null, drop: "noTitle" };

  const startsAt =
    toIsoInstant(event.startdate) ??
    toIsoInstant(event.openingtimes?.doorsopen) ??
    toIsoInstant(nonEmptyString(event.date) ? `${event.date} 20:00:00` : null);
  if (!startsAt) return { row: null, drop: "noStart" };

  const row = {
    id: stableId("events-sk", `${event.id ?? title}|${placeName}|${startsAt}`),
    placeName: placeName.trim(),
    kind,
    startsAt,
    title,
    source: { ...SKIDDLE_SOURCE, url },
    observedAt,
    confidence: "listed",
  };

  const sourceId = asSourceId(event.id);
  if (sourceId) row.sourceId = sourceId;
  const imageUrl = firstImageUrl([
    { url: event.largeimageurl },
    { url: event.imageurl },
    { url: event.imageurlhttps },
  ]);
  if (imageUrl) row.imageUrl = imageUrl;

  const lat = finiteNum(venue.latitude);
  const lng = finiteNum(venue.longitude);
  if (lat !== null) row.lat = lat;
  if (lng !== null) row.lng = lng;

  const endsAt = toIsoInstant(event.enddate);
  if (endsAt) row.endsAt = endsAt;

  const gbp = parseGbp(event.entryprice);
  if (gbp !== null) row.priceGbp = gbp;

  if (nonEmptyString(event.genre)) row.detail = event.genre.trim();

  return {
    row: attachVenue(row, {
      name: placeName,
      address: venue.address ?? "",
      postcode: venue.postcode ?? "",
      lat,
      lng,
    }, venueIndex),
    drop: null,
  };
}

export function mapSkiddleEvent(event, opts = {}) {
  return classifySkiddleEvent(event, opts).row;
}

export function normaliseSkiddleEvents(payload, opts = {}) {
  const dropped = emptyEventDrops();
  const results = payload?.results;
  if (!Array.isArray(results)) return { rows: [], dropped };
  const rows = [];
  for (const event of results) {
    const { row, drop } = classifySkiddleEvent(event, opts);
    if (row) rows.push(row);
    else if (drop) noteDrop(dropped, drop);
  }
  return { rows, dropped };
}

// ---------------------------------------------------------------------------
// Fetchers (impure — only run from main(), never imported by tests)
// ---------------------------------------------------------------------------

async function fetchTicketmaster(apiKey, { nowMs, city = "london" }) {
  const geo = cityGeo(city);
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.search = new URLSearchParams({
    apikey: apiKey,
    countryCode: "GB",
    latlong: `${geo.lat},${geo.lng}`,
    radius: String(geo.radiusMiles),
    unit: "miles",
    startDateTime: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
    endDateTime: new Date(nowMs + FORWARD_HORIZON_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    size: "100",
    sort: "date,asc",
  }).toString();
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-events/1" } });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Ticketmaster Discovery API returned ${res.status}`);
  }
  return res.json();
}

const SKIDDLE_FETCH_CODES = Object.keys(SKIDDLE_EVENTCODE_KIND).join(",");

async function fetchSkiddle(apiKey, { nowMs, city = "london" }) {
  const geo = cityGeo(city);
  const url = new URL("https://www.skiddle.com/api/v1/events/search/");
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  url.search = new URLSearchParams({
    api_key: apiKey,
    latitude: String(geo.lat),
    longitude: String(geo.lng),
    radius: String(geo.radiusMiles),
    eventcode: SKIDDLE_FETCH_CODES,
    minDate: fmt(nowMs),
    maxDate: fmt(nowMs + FORWARD_HORIZON_MS),
    order: "date",
    limit: "100",
    description: "1",
  }).toString();
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-events/1" } });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Skiddle Events API returned ${res.status}`);
  }
  return res.json();
}

export function readExistingCommonRows(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const rows = Array.isArray(raw?.rows) ? raw.rows : [];
    return rows.filter((row) => row?.source?.label?.toLowerCase() === "common");
  } catch {
    return [];
  }
}

export function parseEventsCityArg(argv = process.argv) {
  const flagged = argv.find((arg) => arg.startsWith("--city="));
  const city = flagged ? flagged.slice("--city=".length).trim().toLowerCase() : "london";
  return EVENT_REFRESH_CITIES.includes(city) ? city : null;
}

// ---------------------------------------------------------------------------
// main: fetch enabled providers, normalise, write events_london.json
// ---------------------------------------------------------------------------

function serialiseFile(payload) {
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = payload.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  return payload.rows.length ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n` : `${meta},\n  "rows": []\n}\n`;
}

async function main() {
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const city = parseEventsCityArg(process.argv);
  if (!city) {
    console.error(
      `eventsRefresh: unknown city. Use one of ${EVENT_REFRESH_CITIES.join(", ")}.`,
    );
    process.exitCode = 1;
    return;
  }
  const outPath = eventsOutputPath(city);
  const lanes = providerLaneStatus();
  console.log(
    `eventsRefresh: city=${city} ticketmaster=${lanes.ticketmaster} skiddle=${lanes.skiddle}`,
  );

  const tmKey = process.env.TICKETMASTER_API_KEY;
  const skKey = process.env.SKIDDLE_API_KEY;

  if (!nonEmptyString(tmKey) && !nonEmptyString(skKey)) {
    console.log(
      "eventsRefresh: no provider keys present (TICKETMASTER_API_KEY / SKIDDLE_API_KEY). " +
        "Lanes stay not-configured. Leaving the events file untouched.",
    );
    return;
  }

  const venueIndex = loadCanonicalVenueIndex();
  const allRows = [];
  const providersRun = [];
  const dropped = emptyEventDrops();

  if (nonEmptyString(tmKey)) {
    try {
      const payload = await fetchTicketmaster(tmKey, { nowMs, city });
      const result = normaliseTicketmasterEvents(payload, { observedAt, venueIndex });
      allRows.push(...result.rows);
      dropped.noKind += result.dropped.noKind;
      dropped.noPlace += result.dropped.noPlace;
      dropped.noStart += result.dropped.noStart;
      dropped.noUrl += result.dropped.noUrl;
      dropped.noTitle += result.dropped.noTitle;
      dropped.total += result.dropped.total;
      providersRun.push({ provider: "ticketmaster", rows: result.rows.length });
      console.log(
        `eventsRefresh: Ticketmaster -> ${result.rows.length} rows, ${summariseEventDrops(result.dropped)}`,
      );
    } catch (err) {
      console.error(
        `eventsRefresh: Ticketmaster fetch failed (${err.message}) - skipping provider, not clobbering file.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (nonEmptyString(skKey)) {
    try {
      const payload = await fetchSkiddle(skKey, { nowMs, city });
      const result = normaliseSkiddleEvents(payload, { observedAt, venueIndex });
      allRows.push(...result.rows);
      dropped.noKind += result.dropped.noKind;
      dropped.noPlace += result.dropped.noPlace;
      dropped.noStart += result.dropped.noStart;
      dropped.noUrl += result.dropped.noUrl;
      dropped.noTitle += result.dropped.noTitle;
      dropped.total += result.dropped.total;
      providersRun.push({ provider: "skiddle", rows: result.rows.length });
      console.log(
        `eventsRefresh: Skiddle -> ${result.rows.length} rows, ${summariseEventDrops(result.dropped)}`,
      );
    } catch (err) {
      console.error(
        `eventsRefresh: Skiddle fetch failed (${err.message}) - skipping provider, not clobbering file.`,
      );
      process.exitCode = 1;
      return;
    }
  } else {
    console.log("eventsRefresh: Skiddle lane not-configured (no SKIDDLE_API_KEY).");
  }

  const commonRows = city === "london" ? readExistingCommonRows(outPath) : [];
  allRows.push(...commonRows);

  // Fail closed: a successful run that yields zero rows across every enabled
  // provider is more likely an upstream hiccup than a genuinely empty city -
  // refuse to clobber a good file unless --allow-empty is passed.
  const allowEmpty = process.argv.includes("--allow-empty");
  if (allRows.length === 0 && !allowEmpty) {
    console.error(
      `eventsRefresh: aborting - enabled provider(s) returned 0 mappable rows. ` +
        `Refusing to overwrite ${outPath}. Pass --allow-empty to override.`,
    );
    process.exitCode = 1;
    return;
  }

  const deduped = dedupeEventRowsBySourceId(allRows);
  // A Common row states a DATE and no clock time, so it sorts on that instead.
  const whenOf = (row) => row.startsAt ?? row.startsDate ?? "";
  deduped.sort((a, b) => whenOf(a).localeCompare(whenOf(b)) || a.id.localeCompare(b.id));

  const countBy = (provider) =>
    deduped.filter((r) => r.source.label.toLowerCase().startsWith(provider)).length;
  const payload = {
    generatedAt: observedAt,
    kind: "events",
    region: city === "london" ? "greater-london" : city,
    city,
    sources: [
      {
        ...TICKETMASTER_SOURCE,
        firstParty: false,
        provider: "ticketmaster",
        rowsEmitted: countBy("ticketmaster"),
        notes:
          "Official Ticketmaster Discovery API v2 (GB market, city bbox). Music->music, " +
          "Sports->sport, Arts & Theatre/Comedy->event; other segments dropped and counted. " +
          "Each row deep-links back to its own ticketmaster.co.uk event page per the API terms; " +
          "file is fully overwritten each run (transient cache only).",
      },
      {
        ...SKIDDLE_SOURCE,
        firstParty: false,
        provider: "skiddle",
        rowsEmitted: countBy("skiddle"),
        notes:
          "Official Skiddle Events API (city lat/lng radius). LIVE/FEST->music, SPORT->sport, " +
          "CLUB/COMEDY/THEATRE/BARPUB->event; other codes dropped and counted. Commercial use " +
          "requires written approval from dev@skiddle.com; provider stays not-configured " +
          "without SKIDDLE_API_KEY. Name + logo + event link are licence obligations.",
      },
    ],
    rows: deduped,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialiseFile(payload));
  console.log(
    `eventsRefresh: wrote ${deduped.length} event rows -> ${outPath} ` +
      `(${providersRun.map((p) => `${p.provider}:${p.rows}`).join(", ") || "none"}; ` +
      `common kept ${commonRows.length}; ${summariseEventDrops(dropped)})`,
  );

  if (process.argv.includes("--open-pr") && city === "london") {
    const { refreshCommonEvents } = await import("./commonRefresh.mjs");
    await refreshCommonEvents();
  }

  if (!process.argv.includes("--open-pr")) return;
  const stamp = observedAt.slice(0, 10).replaceAll("-", "");
  const branch = `whats-on-events/${stamp}-${process.env.GITHUB_RUN_ID?.replace(/\D/g, "") || nowMs}`;
  execFileSync("git", ["checkout", "-b", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["add", outPath], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(whats-on): refresh events ${stamp}`], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["push", "-u", "origin", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync(
    "gh",
    ["pr", "create", "--title", `What's-On events ${stamp}`, "--body", "Scheduled official-API (Ticketmaster/Skiddle) events refresh for the Tonight page. Provenance links back to each source per its terms."],
    { cwd: ROOT, stdio: "inherit" },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
