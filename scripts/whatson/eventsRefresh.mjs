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

import {
  EVENT_REFRESH_CITIES,
  SKIDDLE_EVENTCODE_KIND,
  cityGeo,
  dedupeEventRowsBySourceId,
  emptyEventDrops,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  summariseEventDrops,
} from "../../lib/whatson/eventNormalise.mjs";
import { loadCanonicalVenueIndex } from "./resolveVenueId.mjs";

export {
  EMPTY_EVENT_DROPS,
  EVENT_REFRESH_CITIES,
  SKIDDLE_EVENTCODE_KIND,
  SKIDDLE_SOURCE,
  TICKETMASTER_SEGMENT_KIND,
  TICKETMASTER_SOURCE,
  cityGeo,
  dedupeEventRowsBySourceId,
  emptyEventDrops,
  mapSkiddleEvent,
  mapTicketmasterEvent,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  summariseEventDrops,
  toIsoInstant,
} from "../../lib/whatson/eventNormalise.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// How far ahead to pull. The store re-windows to "tonight" and drops stale
// rows, so a small forward horizon keeps the cached file short-lived (honouring
// Ticketmaster's "reasonable period" caching term) while surviving a missed run.
const FORWARD_HORIZON_MS = 2 * 24 * 60 * 60 * 1000;


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
