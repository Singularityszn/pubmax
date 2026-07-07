// GET /api/last-train?lat=..&lng=..  →  LastTrainResult
//
// "Last Pint": given a point (a pub), find the nearest Tube/rail station, when the
// last train of the night leaves each serving line, what's due next right now, a
// pub-native decision ("order one more" ... "train risk"), and the 3 nearest pubs
// to the station for a final pint by the platform. Covers user stories 19-24.
//
// Strategy
// --------
//  1. Nearest station: TfL Unified API `GET /StopPoint?lat&lon&stopTypes&radius&modes`
//     returns stations nearest-first, each with the lines that serve it.
//  2. Per line (capped at LINE_CAP to respect the ~50 req/min keyless rate limit):
//     - Last train: `GET /Line/{lineId}/Timetable/{stationId}` → today's day-type
//       schedule's `lastJourney`. TfL's plain timetable call sometimes returns a
//       *disambiguation* (Brixton→Walthamstow vs the reverse) instead of a
//       timetable; when it does we follow the offered direction URIs and merge
//       their schedules. Hours roll past 24 for after-midnight / Night Tube
//       services — formatLastJourney handles that.
//     - Next departures: `GET /StopPoint/{id}/Arrivals` filtered to the line,
//       which is genuinely live (vehicles in service right now). When Arrivals
//       comes back empty for a line (last train of the night has gone, or the
//       line just isn't running), we fall back to the same timetable's *next*
//       scheduled entry after "now" so the card still shows something.
//  3. Pick the LATEST lastJourney across all matching schedules/routes for the line
//     (a station can host several branches; the drinker cares about the last one).
//  4. Disruption: `GET /Line/{ids}/Status` for the served lines feeds both the
//     card's disruption note and the decision's train_risk trigger.
//  5. Decision: computeLastPintDecision (lib/tfl.ts, pure + unit tested) combines
//     the last train, a haversine walk estimate, a fixed buffer and disruption
//     state into one of the five pub-native states.
//  6. Nearest pubs: haversine (lib/haversine.ts) against the bundled venue index,
//     sorted by distance to the station, top 3 with id/name/price.
//
// Caching: timetables/last-train barely change, so that half of the answer can
// sit at the CDN edge for an hour. Arrivals are genuinely live (vehicles change
// minute to minute) and are never cached here — see `json()` below, which forces
// `no-store` whenever the departures/decision use live data so a stale "next
// train in 2 min" can never be served from a shared cache.
//
// Robustness: every TfL call is wrapped in try/catch with a short per-call
// AbortController timeout. This route NEVER throws and NEVER 500s the user — if the
// nearest-station lookup fails or finds nothing, it returns 200 with an `error`
// string and an empty body the card can show gracefully (user story 24).

import {
  computeLastPintDecision,
  dayTypeForDate,
  formatLastJourney,
  lineColour,
  matchesDayType,
  walkMinutesForKm,
  type DayType,
  type LastTrain,
  type LastTrainResult,
  type NearestPub,
  type NextDepartures,
} from "@/lib/tfl";
import { haversineKm } from "@/lib/haversine";
import { getPricedVenues } from "@/lib/venuePriceIndex";

export const runtime = "nodejs";
// The nearest-station geo query plus the concurrent timetable fan-out can take
// several seconds from a serverless region; give the function room to finish.
export const maxDuration = 30;

const TFL_BASE = "https://api.tfl.gov.uk";
const STATION_RADIUS_M = 1500;
// Broad coverage: metro + national-rail stations, across the modes a Londoner
// heading home actually uses. modes narrows StopPoint results to real options.
const STOP_TYPES = "NaptanMetroStation,NaptanRailStation";
const MODES = "tube,dlr,elizabeth-line,overground";
// Cap the timetable fan-out so a busy interchange (many lines) can't blow the
// keyless rate limit; four lines is plenty for a "head home" glance.
const LINE_CAP = 4;
// TfL's StopPoint geo query is ~3s and slower from a serverless region; give it
// headroom so a slow-but-fine response isn't aborted as a "failure".
const CALL_TIMEOUT_MS = 9000;

// app_key is optional — the keyless API works fine. Only append it when present.
function withKey(url: string): string {
  const key = process.env.TFL_APP_KEY;
  if (!key) return url;
  return url + (url.includes("?") ? "&" : "?") + `app_key=${encodeURIComponent(key)}`;
}

// One TfL GET, JSON-parsed, with a hard per-call timeout. Returns null on ANY
// failure (network, timeout, non-2xx, bad JSON) — callers decide what null means.
// `retries` adds attempts for transient failures (timeouts, 429 rate-limit, 5xx);
// a genuine 4xx (other than 429) is not retried. A descriptive User-Agent keeps
// us on the right side of TfL's fair-use expectations.
async function tflGet<T>(path: string, retries = 0): Promise<T | null> {
  const url = path.startsWith("http") ? path : `${TFL_BASE}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetch(withKey(url), {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "PubMaxxing/1.0 (+https://pubmaxxing.com)",
        },
      });
      if (res.ok) return (await res.json()) as T;
      // Only transient statuses are worth another attempt.
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      // network / timeout — fall through and retry if attempts remain
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// --- Minimal shapes for just the fields we read off the TfL responses. ---

type StopPointLine = { id?: string; name?: string };
type StopPoint = {
  id?: string;
  commonName?: string;
  distance?: number;
  lines?: StopPointLine[];
  lat?: number;
  lon?: number;
};
type StopPointResponse = { stopPoints?: StopPoint[] };

// TfL sends hour/minute as strings ("24", "34"); coerce defensively.
type KnownJourney = { hour?: number | string; minute?: number | string };
type Schedule = { name?: string; lastJourney?: KnownJourney };
type Route = { schedules?: Schedule[] };
type DisambiguationOption = { uri?: string };
type TimetableResponse = {
  timetable?: { routes?: Route[] };
  disambiguation?: { disambiguationOptions?: DisambiguationOption[] };
};

// TfL Arrivals: one entry per vehicle currently predicted for this stop.
type ArrivalPrediction = {
  lineId?: string;
  lineName?: string;
  timeToStation?: number; // seconds from now
  expectedArrival?: string; // ISO
};

// TfL Line Status: `lineStatuses[].statusSeverityDescription` of "Good Service"
// means nothing to report; anything else is a disruption worth surfacing.
type LineStatusEntry = {
  id?: string;
  name?: string;
  lineStatuses?: { statusSeverityDescription?: string; reason?: string }[];
};

function toInt(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : null;
}

// Total minutes-since-midnight of a lastJourney, used only to pick the LATEST one.
// After-midnight hours (>=24) sort naturally after evening times, which is exactly
// what we want ("the last train" is the one with the largest hour:minute).
function journeyRank(j: KnownJourney): number | null {
  const hour = toInt(j.hour);
  const minute = toInt(j.minute);
  if (hour === null || minute === null) return null;
  return hour * 60 + minute;
}

// Gather every schedule from a timetable response. If TfL handed back a
// disambiguation (no routes, but direction options), follow each offered URI and
// merge the schedules it yields. Bounded: at most the options TfL lists (2 for a
// two-terminus line).
async function collectSchedules(lineId: string, stationId: string): Promise<Schedule[]> {
  const direct = await tflGet<TimetableResponse>(
    `/Line/${encodeURIComponent(lineId)}/Timetable/${encodeURIComponent(stationId)}`,
  );
  if (!direct) return [];

  const routes = direct.timetable?.routes ?? [];
  if (routes.length > 0) {
    return routes.flatMap((r) => r.schedules ?? []);
  }

  // Disambiguation branch: follow the direction URIs (they already carry the
  // ?direction=.. query TfL wants) and merge whatever schedules come back.
  const options = direct.disambiguation?.disambiguationOptions ?? [];
  const schedules: Schedule[] = [];
  for (const opt of options) {
    if (!opt.uri) continue;
    const resolved = await tflGet<TimetableResponse>(opt.uri);
    for (const route of resolved?.timetable?.routes ?? []) {
      schedules.push(...(route.schedules ?? []));
    }
  }
  return schedules;
}

// The latest lastJourney for one line at one station on today's day-type, formatted
// for the card. Returns null if the line has no schedule matching today (or TfL
// failed for it) — the caller simply omits that line.
async function lastTrainForLine(
  lineId: string,
  lineName: string,
  stationId: string,
  dayType: DayType,
): Promise<LastTrain | null> {
  const schedules = await collectSchedules(lineId, stationId);

  let best: KnownJourney | null = null;
  let bestRank = -Infinity;
  for (const schedule of schedules) {
    if (!schedule.name || !matchesDayType(schedule.name, dayType)) continue;
    if (!schedule.lastJourney) continue;
    const rank = journeyRank(schedule.lastJourney);
    if (rank === null) continue;
    if (rank > bestRank) {
      bestRank = rank;
      best = schedule.lastJourney;
    }
  }
  if (!best) return null;

  const hour = toInt(best.hour);
  const minute = toInt(best.minute);
  if (hour === null || minute === null) return null;

  const { clock, pastMidnight } = formatLastJourney({ hour, minute });
  return { lineId, lineName, colour: lineColour(lineId), clock, pastMidnight };
}

// How many upcoming departures to show per line (user story 20: "next 2-3").
const DEPARTURES_PER_LINE = 3;
// How many nearest pubs to surface for "a final pint by the platform" (story 22).
const NEAREST_PUB_COUNT = 3;

// Format a Date to a "HH:MM" wall-clock string in London local time (arrivals
// come back as absolute ISO instants; timetable fallback entries are already
// day-relative minutes — both funnel through this so the card sees one shape).
function toLondonClock(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

// Live next departures for one line at one station, via TfL Arrivals — genuinely
// real-time (vehicles currently in service), unlike the static timetable. Sorted
// soonest-first and capped to DEPARTURES_PER_LINE. Returns [] (not null) when
// Arrivals has nothing for this line right now (service ended, or a quiet gap);
// the caller decides whether/how to fall back.
async function nextDeparturesForLine(
  lineId: string,
  stationId: string,
): Promise<{ clock: string }[]> {
  const arrivals = await tflGet<ArrivalPrediction[]>(
    `/StopPoint/${encodeURIComponent(stationId)}/Arrivals`,
  );
  if (!arrivals) return [];
  return arrivals
    .filter((a) => a.lineId === lineId)
    .map((a) => {
      if (a.expectedArrival) {
        const d = new Date(a.expectedArrival);
        if (!Number.isNaN(d.getTime())) return { clock: toLondonClock(d), sortKey: d.getTime() };
      }
      const seconds = a.timeToStation ?? 0;
      const d = new Date(Date.now() + seconds * 1000);
      return { clock: toLondonClock(d), sortKey: d.getTime() };
    })
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, DEPARTURES_PER_LINE)
    .map(({ clock }) => ({ clock }));
}

// Timetable-based fallback for "next departures" when live Arrivals is empty for
// a line (e.g. after the last live vehicle but before we've given up on the
// night, or Arrivals is temporarily quiet). Reuses the same schedules the
// last-train lookup already collected — no extra TfL calls — and picks the
// smallest-rank journeys that are still >= "now" (in minutes-since-midnight),
// falling back further to today's lastJourney alone if nothing else matches.
function nextFromSchedulesAfter(
  schedules: Schedule[],
  dayType: DayType,
  nowMinutes: number,
): { clock: string }[] {
  const ranked: number[] = [];
  for (const schedule of schedules) {
    if (!schedule.name || !matchesDayType(schedule.name, dayType)) continue;
    if (!schedule.lastJourney) continue;
    const rank = journeyRank(schedule.lastJourney);
    if (rank !== null) ranked.push(rank);
  }
  const upcoming = ranked.filter((r) => r >= nowMinutes).sort((a, b) => a - b);
  const chosen = (upcoming.length > 0 ? upcoming : ranked.sort((a, b) => a - b)).slice(
    0,
    DEPARTURES_PER_LINE,
  );
  return chosen.map((rank) => {
    const { clock } = formatLastJourney({ hour: Math.floor(rank / 60), minute: rank % 60 });
    return { clock };
  });
}

// Combined "next departures" for one line: try live Arrivals first (real-time),
// and only fall back to the timetable when Arrivals comes back empty for this
// line. `live` on the returned shape tells the card (and the decision) which
// source won, since a timetable fallback is not a disruption signal on its own.
async function departuresForLine(
  lineId: string,
  lineName: string,
  stationId: string,
  dayType: DayType,
  nowMinutes: number,
): Promise<NextDepartures> {
  const live = await nextDeparturesForLine(lineId, stationId);
  if (live.length > 0) {
    return {
      lineId,
      lineName,
      colour: lineColour(lineId),
      times: live.map((l) => l.clock),
      live: true,
    };
  }
  const schedules = await collectSchedules(lineId, stationId);
  const fallback = nextFromSchedulesAfter(schedules, dayType, nowMinutes);
  return {
    lineId,
    lineName,
    colour: lineColour(lineId),
    times: fallback.map((f) => f.clock),
    live: false,
  };
}

// Disruption summary for the served lines (user stories 21, 24): TfL Line
// Status, one call for all lineIds at once. Returns null when every line is
// "Good Service" (nothing to say) and a short human line when not. Also
// returns whether ANY of `neededLineIds` is affected, for the decision's
// train_risk trigger.
async function lineDisruptions(
  lineIds: string[],
): Promise<{ summary: string | null; affectedLineIds: Set<string> }> {
  if (lineIds.length === 0) return { summary: null, affectedLineIds: new Set() };
  const statuses = await tflGet<LineStatusEntry[]>(
    `/Line/${encodeURIComponent(lineIds.join(","))}/Status`,
  );
  if (!statuses) return { summary: null, affectedLineIds: new Set() };

  const affectedLineIds = new Set<string>();
  const notes: string[] = [];
  for (const line of statuses) {
    const worst = (line.lineStatuses ?? []).find(
      (s) => s.statusSeverityDescription && s.statusSeverityDescription !== "Good Service",
    );
    if (worst && line.id) {
      affectedLineIds.add(line.id);
      notes.push(`${line.name ?? line.id}: ${worst.statusSeverityDescription}`);
    }
  }
  return { summary: notes.length > 0 ? notes.join(" · ") : null, affectedLineIds };
}

// The 3 nearest pubs to the station (user story 22) — reuses the shared
// haversine (lib/haversine.ts) against the bundled, price-carrying venue list
// (lib/venuePriceIndex.ts, memoized from the same dataset venueIndex.ts reads).
async function nearestPubsToStation(stationLat: number, stationLng: number): Promise<NearestPub[]> {
  const venues = await getPricedVenues();
  const withDistance = venues.map((v) => ({
    v,
    km: haversineKm([stationLng, stationLat], [v.longitude, v.latitude]),
  }));
  withDistance.sort((a, b) => a.km - b.km);
  return withDistance.slice(0, NEAREST_PUB_COUNT).map(({ v }) => ({
    id: v.id,
    name: v.name,
    price: v.cheapestPrice,
  }));
}

// "Now" in London, so the weekday we pick the timetable for is the drinker's, not
// the server's. Intl gives us the London-local Y/M/D; we rebuild a Date whose
// getDay() is the London weekday (dayTypeForDate reads getDay()).
function londonNow(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
  );
}

// Cache policy (see file header): only a fully-resolved, all-timetable answer
// (no live arrivals/decision involved) is cacheable at the edge for an hour —
// timetables barely move. Anything touching live Arrivals or the decision (which
// is itself time-sensitive, "leave by" ticks every minute) is `no-store`, and any
// error/empty result is `no-store` too so a transient TfL hiccup never sticks.
function json(body: unknown, opts: { status?: number; cache?: boolean } = {}): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? "public, s-maxage=3600, stale-while-revalidate=86400"
        : "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lng = Number.parseFloat(params.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "lat and lng are required numbers." }, { status: 400 });
  }
  // Destination stays session-only end-to-end (user story 23): this route never
  // persists it anywhere (no DB write, no cookie, no log of the label) — it's an
  // optional, purely-passthrough label for the decision's `destinationLabel`.
  const destinationLabel = params.get("destination")?.trim() || null;

  // 1) Nearest station. Retried once for transient failures; any failure here is
  // graceful (200 + error, NOT cached), never a 500 — degrade per user story 24.
  const stopUrl =
    `/StopPoint?lat=${lat}&lon=${lng}` +
    `&stopTypes=${STOP_TYPES}&radius=${STATION_RADIUS_M}&modes=${MODES}`;
  const stops = await tflGet<StopPointResponse>(stopUrl, 1);
  const nearest = stops?.stopPoints?.[0];
  if (!nearest?.id) {
    const decision = computeLastPintDecision({
      minutesUntilLastTrain: null,
      walkMinutesEstimate: 0,
      stationName: "Nearest station",
      lineNames: [],
      disruptionOnNeededLine: false,
      destinationLabel,
      live: false,
    });
    return json({
      error: "Couldn't reach TfL just now — check before you head out.",
      station: null,
      trains: [],
      departures: [],
      decision,
      nearestPubs: [],
      generatedAt: new Date().toISOString(),
    });
  }

  const now = londonNow();
  const dayType = dayTypeForDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // 2) Unique serving lines, capped, resolved concurrently.
  const seen = new Set<string>();
  const lines: StopPointLine[] = [];
  for (const line of nearest.lines ?? []) {
    if (!line.id || seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
    if (lines.length >= LINE_CAP) break;
  }
  const lineIds = lines.map((l) => l.id as string);

  const [lastTrainResults, departureResults, disruption, nearestPubs] = await Promise.all([
    Promise.all(
      lines.map((line) =>
        lastTrainForLine(line.id as string, line.name ?? (line.id as string), nearest.id as string, dayType),
      ),
    ),
    Promise.all(
      lines.map((line) =>
        departuresForLine(
          line.id as string,
          line.name ?? (line.id as string),
          nearest.id as string,
          dayType,
          nowMinutes,
        ),
      ),
    ),
    lineDisruptions(lineIds),
    typeof nearest.lat === "number" && typeof nearest.lon === "number"
      ? nearestPubsToStation(nearest.lat, nearest.lon)
      : Promise.resolve<NearestPub[]>([]),
  ]);

  // Keep only lines we actually resolved; sort earliest-departing first so the
  // most urgent "leave now" line is at the top.
  const trains: LastTrain[] = lastTrainResults
    .filter((t): t is LastTrain => t !== null)
    .sort((a, b) => a.clock.localeCompare(b.clock));

  const departures: NextDepartures[] = departureResults.filter((d) => d.times.length > 0);
  const anyLiveDepartures = departures.some((d) => d.live);

  // Walk estimate: venue (the point the card was called with) → station,
  // straight-line haversine at a brisk walking pace. Labeled as straight-line in
  // the response shape so the card can be honest about it (no routed distance).
  const walkKm =
    typeof nearest.lat === "number" && typeof nearest.lon === "number"
      ? haversineKm([lng, lat], [nearest.lon, nearest.lat])
      : 0;
  const walkMinutesEstimate = walkMinutesForKm(walkKm);

  // Minutes until the last train that matters: the LATEST across all resolved
  // lines (any one of them gets the drinker home), measured from "now".
  let minutesUntilLastTrain: number | null = null;
  for (const t of trains) {
    const [h, m] = t.clock.split(":").map(Number);
    let mins = h * 60 + m - nowMinutes;
    if (t.pastMidnight || mins < -60) mins += 24 * 60; // past-midnight trains are "tomorrow"
    if (minutesUntilLastTrain === null || mins > minutesUntilLastTrain) minutesUntilLastTrain = mins;
  }

  const decision = computeLastPintDecision({
    minutesUntilLastTrain,
    walkMinutesEstimate,
    stationName: nearest.commonName ?? "Nearest station",
    lineNames: lines.map((l) => l.name ?? (l.id as string)),
    disruptionOnNeededLine: lineIds.some((id) => disruption.affectedLineIds.has(id)),
    disruptionSummary: disruption.summary,
    destinationLabel,
    live: true,
    now: new Date(),
  });

  const result: LastTrainResult = {
    station: {
      id: nearest.id,
      name: nearest.commonName ?? "Nearest station",
      distanceM: Math.round(nearest.distance ?? 0),
    },
    trains,
    departures,
    decision,
    nearestPubs,
    generatedAt: new Date().toISOString(),
  };
  // Cache only when nothing live was involved (no live Arrivals resolved) and we
  // have at least one timetable train — a live-touched or empty answer must
  // never be pinned at the shared edge cache (see file header + json() above).
  return json(result, { cache: trains.length > 0 && !anyLiveDepartures });
}
