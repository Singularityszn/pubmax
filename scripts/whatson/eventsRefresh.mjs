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
//     tonight-window + STALE_AFTER_MS drop expired rows — the checked-in file
//     is only ever a short-lived working cache. Every row links back to its
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
// KIND MAPPING (conservative, honest partial): our four kinds are
// sport/quiz/deal/music. Only unambiguous classifications map — Ticketmaster
// "Music"->music / "Sports"->sport; Skiddle "LIVE"/"FEST"->music, "SPORT"->
// sport. Everything else (theatre, comedy, generic BARPUB, …) is DROPPED
// rather than dishonestly forced into a kind it isn't.
//
// VENUE MATCHING (W6): each normalised row is passed through the shared,
// conservative resolveVenueId (exact grouping-key OR normalized-name +
// postcode/proximity confirmation, null on ambiguity). Unmatched events are
// STILL LISTED with their own venue name — they just don't carry a venueId.

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveVenueId, loadCanonicalVenueIndex } from "./resolveVenueId.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "events_london.json");

// Greater-London centroid + radius for the Skiddle lat/lng search.
const LONDON = { lat: 51.5074, lng: -0.1278, radiusMiles: 15 };
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

// Only unambiguous classifications map. Everything absent from these maps is
// intentionally dropped (see KIND MAPPING above).
export const TICKETMASTER_SEGMENT_KIND = {
  Music: "music",
  Sports: "sport",
};

export const SKIDDLE_EVENTCODE_KIND = {
  LIVE: "music",
  FEST: "music",
  SPORT: "sport",
};

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
export function mapTicketmasterEvent(event, { observedAt, venueIndex = null } = {}) {
  if (!event || typeof event !== "object") return null;

  const classifications = Array.isArray(event.classifications) ? event.classifications : [];
  const kind = ticketmasterKind(classifications);
  if (!kind) return null;

  const venue = event._embedded?.venues?.[0];
  const placeName = venue?.name;
  if (!nonEmptyString(placeName)) return null;

  const url = httpUrl(event.url);
  if (!url) return null; // provenance non-negotiable

  const title = nonEmptyString(event.name) ? event.name.trim() : null;
  if (!title) return null;

  const startsAt = ticketmasterStart(event.dates?.start);
  if (!startsAt) return null; // can't window an event with no usable start

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

  const lat = finiteNum(venue?.location?.latitude);
  const lng = finiteNum(venue?.location?.longitude);
  if (lat !== null) row.lat = lat;
  if (lng !== null) row.lng = lng;

  const price = event.priceRanges?.find((p) => p?.currency === "GBP");
  const gbp = parseGbp(price?.min);
  if (gbp !== null) row.priceGbp = gbp;

  const genre = classifications.find((c) => nonEmptyString(c?.genre?.name))?.genre?.name;
  if (nonEmptyString(genre)) row.detail = genre.trim();

  return attachVenue(row, {
    name: placeName,
    address: venue?.address?.line1 ?? "",
    postcode: venue?.postalCode ?? "",
    lat,
    lng,
  }, venueIndex);
}

export function normaliseTicketmasterEvents(payload, opts = {}) {
  const events = payload?._embedded?.events;
  if (!Array.isArray(events)) return [];
  const rows = [];
  for (const event of events) {
    const row = mapTicketmasterEvent(event, opts);
    if (row) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Skiddle normalisation (pure)
// ---------------------------------------------------------------------------

// Map one Skiddle Events-API result to a WhatsOnRow, or null.
export function mapSkiddleEvent(event, { observedAt, venueIndex = null } = {}) {
  if (!event || typeof event !== "object") return null;

  const code = event.EventCode ?? event.eventcode;
  const kind = nonEmptyString(code) ? SKIDDLE_EVENTCODE_KIND[code] : undefined;
  if (!kind) return null;

  const venue = event.venue ?? {};
  const placeName = venue.name;
  if (!nonEmptyString(placeName)) return null;

  const url = httpUrl(event.link);
  if (!url) return null; // provenance non-negotiable

  const title = nonEmptyString(event.eventname) ? event.eventname.trim() : null;
  if (!title) return null;

  const startsAt =
    toIsoInstant(event.startdate) ??
    toIsoInstant(event.openingtimes?.doorsopen) ??
    toIsoInstant(nonEmptyString(event.date) ? `${event.date} 20:00:00` : null);
  if (!startsAt) return null;

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

  const lat = finiteNum(venue.latitude);
  const lng = finiteNum(venue.longitude);
  if (lat !== null) row.lat = lat;
  if (lng !== null) row.lng = lng;

  const endsAt = toIsoInstant(event.enddate);
  if (endsAt) row.endsAt = endsAt;

  const gbp = parseGbp(event.entryprice);
  if (gbp !== null) row.priceGbp = gbp;

  if (nonEmptyString(event.genre)) row.detail = event.genre.trim();

  return attachVenue(row, {
    name: placeName,
    address: venue.address ?? "",
    postcode: venue.postcode ?? "",
    lat,
    lng,
  }, venueIndex);
}

export function normaliseSkiddleEvents(payload, opts = {}) {
  const results = payload?.results;
  if (!Array.isArray(results)) return [];
  const rows = [];
  for (const event of results) {
    const row = mapSkiddleEvent(event, opts);
    if (row) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fetchers (impure — only run from main(), never imported by tests)
// ---------------------------------------------------------------------------

async function fetchTicketmaster(apiKey, { nowMs }) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.search = new URLSearchParams({
    apikey: apiKey,
    countryCode: "GB",
    city: "London",
    classificationName: "Music,Sports",
    startDateTime: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
    endDateTime: new Date(nowMs + FORWARD_HORIZON_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    size: "100",
    sort: "date,asc",
  }).toString();
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-events/1" } });
  if (!res.ok) throw new Error(`Ticketmaster Discovery API returned ${res.status}`);
  return res.json();
}

async function fetchSkiddle(apiKey, { nowMs }) {
  const url = new URL("https://www.skiddle.com/api/v1/events/search/");
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  url.search = new URLSearchParams({
    api_key: apiKey,
    latitude: String(LONDON.lat),
    longitude: String(LONDON.lng),
    radius: String(LONDON.radiusMiles),
    eventcode: "LIVE,FEST,SPORT",
    minDate: fmt(nowMs),
    maxDate: fmt(nowMs + FORWARD_HORIZON_MS),
    order: "date",
    limit: "100",
    description: "1",
  }).toString();
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-events/1" } });
  if (!res.ok) throw new Error(`Skiddle Events API returned ${res.status}`);
  return res.json();
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
  const tmKey = process.env.TICKETMASTER_API_KEY;
  const skKey = process.env.SKIDDLE_API_KEY;

  if (!nonEmptyString(tmKey) && !nonEmptyString(skKey)) {
    console.log(
      "eventsRefresh: no provider keys present (TICKETMASTER_API_KEY / SKIDDLE_API_KEY). " +
        "Noop — leaving events_london.json untouched. Provision a key to activate.",
    );
    return;
  }

  const venueIndex = loadCanonicalVenueIndex();
  const allRows = [];
  const providersRun = [];

  if (nonEmptyString(tmKey)) {
    try {
      const payload = await fetchTicketmaster(tmKey, { nowMs });
      const rows = normaliseTicketmasterEvents(payload, { observedAt, venueIndex });
      allRows.push(...rows);
      providersRun.push({ provider: "ticketmaster", rows: rows.length });
      console.log(`eventsRefresh: Ticketmaster -> ${rows.length} rows`);
    } catch (err) {
      console.error(`eventsRefresh: Ticketmaster fetch failed (${err.message}) — skipping provider, not clobbering file.`);
      process.exitCode = 1;
      return;
    }
  }

  if (nonEmptyString(skKey)) {
    try {
      const payload = await fetchSkiddle(skKey, { nowMs });
      const rows = normaliseSkiddleEvents(payload, { observedAt, venueIndex });
      allRows.push(...rows);
      providersRun.push({ provider: "skiddle", rows: rows.length });
      console.log(`eventsRefresh: Skiddle -> ${rows.length} rows`);
    } catch (err) {
      console.error(`eventsRefresh: Skiddle fetch failed (${err.message}) — skipping provider, not clobbering file.`);
      process.exitCode = 1;
      return;
    }
  }

  // Fail closed: a successful run that yields zero rows across every enabled
  // provider is more likely an upstream hiccup than a genuinely empty city —
  // refuse to clobber a good file unless --allow-empty is passed.
  const allowEmpty = process.argv.includes("--allow-empty");
  if (allRows.length === 0 && !allowEmpty) {
    console.error(
      "eventsRefresh: aborting — enabled provider(s) returned 0 mappable rows. " +
        "Refusing to overwrite events_london.json. Pass --allow-empty to override.",
    );
    process.exitCode = 1;
    return;
  }

  allRows.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));

  const countBy = (provider) => allRows.filter((r) => r.source.label.toLowerCase().startsWith(provider)).length;
  const payload = {
    generatedAt: observedAt,
    kind: "events",
    region: "greater-london",
    sources: [
      {
        ...TICKETMASTER_SOURCE,
        firstParty: false,
        provider: "ticketmaster",
        rowsEmitted: countBy("ticketmaster"),
        notes:
          "Official Ticketmaster Discovery API v2 (GB market, London). Music->music, " +
          "Sports->sport; other segments dropped. Each row deep-links back to its own " +
          "ticketmaster.co.uk event page per the API terms; file is fully overwritten " +
          "each run (transient cache only).",
      },
      {
        ...SKIDDLE_SOURCE,
        firstParty: false,
        provider: "skiddle",
        rowsEmitted: countBy("skiddle"),
        notes:
          "Official Skiddle Events API (London lat/lng radius). LIVE/FEST->music, " +
          "SPORT->sport; other codes dropped. Commercial use requires written approval " +
          "from dev@skiddle.com; provider noop-skips without SKIDDLE_API_KEY.",
      },
    ],
    rows: allRows,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, serialiseFile(payload));
  console.log(
    `eventsRefresh: wrote ${allRows.length} event rows -> ${OUT_PATH} ` +
      `(${providersRun.map((p) => `${p.provider}:${p.rows}`).join(", ")})`,
  );

  if (!process.argv.includes("--open-pr")) return;
  const stamp = observedAt.slice(0, 10).replaceAll("-", "");
  const branch = `whats-on-events/${stamp}-${process.env.GITHUB_RUN_ID?.replace(/\D/g, "") || nowMs}`;
  execFileSync("git", ["checkout", "-b", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["add", OUT_PATH], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(whats-on): refresh events ${stamp}`], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["push", "-u", "origin", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync(
    "gh",
    ["pr", "create", "--title", `What's-On events ${stamp}`, "--body", "Scheduled official-API (Ticketmaster/Skiddle) events refresh for the Tonight page. Provenance links back to each source per its terms."],
    { cwd: ROOT, stdio: "inherit" },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
