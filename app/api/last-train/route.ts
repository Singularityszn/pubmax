// GET /api/last-train?lat=..&lng=..  →  LastTrainResult
//
// "Last drink / last train home": given a point (a pub), find the nearest Tube/rail
// station and, for each line serving it, when the last train of the night leaves.
// A drinker near closing time can glance at this and know when to head off.
//
// Strategy
// --------
//  1. Nearest station: TfL Unified API `GET /StopPoint?lat&lon&stopTypes&radius&modes`
//     returns stations nearest-first, each with the lines that serve it.
//  2. Per line (capped at LINE_CAP to respect the ~50 req/min keyless rate limit):
//     `GET /Line/{lineId}/Timetable/{stationId}` → today's day-type schedule's
//     `lastJourney`. TfL's plain timetable call sometimes returns a *disambiguation*
//     (Brixton→Walthamstow vs the reverse) instead of a timetable; when it does we
//     follow the offered direction URIs and merge their schedules. Hours roll past
//     24 for after-midnight / Night Tube services — formatLastJourney handles that.
//  3. Pick the LATEST lastJourney across all matching schedules/routes for the line
//     (a station can host several branches; the drinker cares about the last one).
//
// Caching: timetables change rarely, so we let the CDN hold the answer for an hour
// and serve stale for a day while revalidating. A future optimisation is a
// precomputed weekly static table (station × day-type → last trains) that would
// remove the live TfL round-trips entirely; this route is the honest live version.
//
// Robustness: every TfL call is wrapped in try/catch with a short per-call
// AbortController timeout. This route NEVER throws and NEVER 500s the user — if the
// nearest-station lookup fails or finds nothing, it returns 200 with an `error`
// string and an empty body the card can show gracefully.

import {
  dayTypeForDate,
  formatLastJourney,
  lineColour,
  matchesDayType,
  type DayType,
  type LastTrain,
  type LastTrainResult,
} from "@/lib/tfl";

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

// Only a successful result (a real station + at least one train) is cacheable —
// timetables barely move, so hold it at the edge for an hour. Errors and empty
// results are `no-store` so a transient TfL hiccup never sticks for an hour.
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

  // 1) Nearest station. Retried once for transient failures; any failure here is
  // graceful (200 + error, NOT cached), never a 500.
  const stopUrl =
    `/StopPoint?lat=${lat}&lon=${lng}` +
    `&stopTypes=${STOP_TYPES}&radius=${STATION_RADIUS_M}&modes=${MODES}`;
  const stops = await tflGet<StopPointResponse>(stopUrl, 1);
  const nearest = stops?.stopPoints?.[0];
  if (!nearest?.id) {
    return json({
      error: "Couldn't reach TfL just now — check before you head out.",
      station: null,
      trains: [],
      generatedAt: new Date().toISOString(),
    });
  }

  const dayType = dayTypeForDate(londonNow());

  // 2) Unique serving lines, capped, resolved concurrently.
  const seen = new Set<string>();
  const lines: StopPointLine[] = [];
  for (const line of nearest.lines ?? []) {
    if (!line.id || seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
    if (lines.length >= LINE_CAP) break;
  }

  const results = await Promise.all(
    lines.map((line) =>
      lastTrainForLine(line.id as string, line.name ?? (line.id as string), nearest.id as string, dayType),
    ),
  );

  // Keep only lines we actually resolved; sort earliest-departing first so the
  // most urgent "leave now" line is at the top.
  const trains: LastTrain[] = results
    .filter((t): t is LastTrain => t !== null)
    .sort((a, b) => a.clock.localeCompare(b.clock));

  const result: LastTrainResult = {
    station: {
      id: nearest.id,
      name: nearest.commonName ?? "Nearest station",
      distanceM: Math.round(nearest.distance ?? 0),
    },
    trains,
    generatedAt: new Date().toISOString(),
  };
  // Cache only a complete answer; if we found the station but no timetables came
  // back, don't pin an empty result at the edge — let the next request retry.
  return json(result, { cache: trains.length > 0 });
}
