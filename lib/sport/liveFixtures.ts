// Live sport fixture calendar for What's-On sport rows. Official-API lanes only:
// football-data.org for football when FOOTBALL_DATA_API_KEY is set, with
// TheSportsDB still supplying the non-football leagues; otherwise TheSportsDB's
// documented free tier key for every league (override with THESPORTSDB_API_KEY).
// Keys are read at call time and never logged.

import { londonWallClockToIso } from "../../scripts/whatson/sportFixtures.mjs";
import type { SportFixture } from "../../scripts/whatson/sportFixtures.d.mts";
import { POINT_ROW_GRACE_MS } from "@/lib/whatsOn";

/**
 * How far ahead sport refresh keeps fixtures. Eight days covers the furthest
 * served window (this weekend, read from any weekday) without fanning weeks of
 * fixtures out across every sport pub.
 */
export const SPORT_FIXTURE_HORIZON_MS = 8 * 24 * 60 * 60 * 1000;

/** One deadline per provider lane, so a slow upstream cannot eat the cron budget. */
const SPORT_LANE_TIMEOUT_MS = 8_000;

const FOOTBALL_DATA_SOURCE = {
  label: "football-data.org",
  url: "https://www.football-data.org/",
};

const THESPORTSDB_LABEL = "TheSportsDB";

/** football-data.org competition codes we care about for pub screens. */
const FOOTBALL_DATA_COMPETITIONS = ["PL", "CL", "ELC"] as const;

type TheSportsDbLeague = {
  id: string;
  competition: string;
  football: boolean;
};

const THESPORTSDB_LEAGUES: TheSportsDbLeague[] = [
  { id: "4328", competition: "English Premier League", football: true },
  { id: "4329", competition: "English Championship", football: true },
  { id: "4480", competition: "UEFA Champions League", football: true },
  { id: "4414", competition: "English Premiership Rugby", football: false },
];

const THESPORTSDB_NON_FOOTBALL_LEAGUES = THESPORTSDB_LEAGUES.filter((league) => !league.football);

/**
 * UK football's Saturday 14:45-17:15 broadcast blackout: no pub can legally
 * screen a match kicking off inside it, so a row claiming one would be false.
 */
function isFootballBlackoutKickoff(wall: { date: string; time: string }): boolean {
  const saturday = new Date(`${wall.date}T12:00:00Z`).getUTCDay() === 6;
  return saturday && wall.time >= "14:45" && wall.time < "17:15";
}

export type FetchLiveSportFixturesOpts = {
  now: number;
  endMs: number;
  fetchImpl?: typeof fetch;
};

type LaneOpts = FetchLiveSportFixturesOpts & { startMs: number; signal: AbortSignal };

function readEnvKey(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function londonWallClockFromUtc(isoUtc: string): { date: string; time: string } | null {
  const instant = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoUtc) ? isoUtc : `${isoUtc}Z`);
  if (!Number.isFinite(instant)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  const day = pick("day");
  const month = pick("month");
  const year = pick("year");
  const hour = pick("hour");
  const minute = pick("minute");
  if (!day || !month || !year || hour === undefined || minute === undefined) return null;
  const hh = hour === "24" ? "00" : hour;
  return {
    date: `${year}-${month}-${day}`,
    time: `${hh}:${minute}`,
  };
}

function fixtureInstantMs(fixture: SportFixture): number | null {
  const iso = londonWallClockToIso(fixture.kickoffLondonDate, fixture.kickoffLondonTime);
  if (!iso) return null;
  return Date.parse(iso);
}

function inWindow(fixture: SportFixture, startMs: number, endMs: number): boolean {
  const kickoff = fixtureInstantMs(fixture);
  if (kickoff === null || !Number.isFinite(kickoff)) return false;
  return kickoff >= startMs && kickoff <= endMs;
}

function dedupeFixtures(fixtures: SportFixture[]): SportFixture[] {
  const seen = new Set<string>();
  const out: SportFixture[] = [];
  for (const fixture of fixtures) {
    const key = `${fixture.kickoffLondonDate}|${fixture.kickoffLondonTime}|${fixture.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fixture);
  }
  out.sort((a, b) => {
    const ak = fixtureInstantMs(a) ?? 0;
    const bk = fixtureInstantMs(b) ?? 0;
    return ak - bk || a.id.localeCompare(b.id);
  });
  return out;
}

type FootballDataMatch = {
  id?: number;
  utcDate?: string;
  status?: string;
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
  competition?: { name?: string };
  venue?: string;
};

function normaliseFootballDataMatch(match: FootballDataMatch): SportFixture | null {
  const utcDate = match.utcDate;
  const home = match.homeTeam?.name;
  const away = match.awayTeam?.name;
  if (!utcDate || !home || !away) return null;
  const status = String(match.status ?? "").toUpperCase();
  if (status === "FINISHED" || status === "CANCELLED" || status === "POSTPONED") return null;
  const wall = londonWallClockFromUtc(utcDate);
  if (!wall || isFootballBlackoutKickoff(wall)) return null;
  const competition = match.competition?.name ?? "Football";
  const venue = typeof match.venue === "string" && match.venue.length > 0 ? match.venue : "TBC";
  const id = typeof match.id === "number" ? `fd-${match.id}` : `fd-${home}-${away}-${wall.date}`;
  return {
    id,
    title: `${home} v ${away} - ${competition}`,
    competition,
    venue,
    kickoffLondonDate: wall.date,
    kickoffLondonTime: wall.time,
    source: FOOTBALL_DATA_SOURCE,
  };
}

async function fetchFootballDataCompetition(
  opts: LaneOpts,
  key: string,
  code: (typeof FOOTBALL_DATA_COMPETITIONS)[number],
): Promise<SportFixture[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`https://api.football-data.org/v4/competitions/${code}/matches`);
  url.searchParams.set("dateFrom", isoDateUtc(opts.startMs));
  url.searchParams.set("dateTo", isoDateUtc(opts.endMs));
  const res = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "X-Auth-Token": key,
      "user-agent": "PubmaxxingBot/0.1 (+https://pubmaxxing.com)",
    },
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `football-data.org ${code} returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
    );
  }
  const payload = (await res.json()) as { matches?: FootballDataMatch[] };
  const fixtures: SportFixture[] = [];
  for (const match of payload.matches ?? []) {
    const fixture = normaliseFootballDataMatch(match);
    if (fixture) fixtures.push(fixture);
  }
  return fixtures;
}

async function fetchFootballDataFixtures(opts: LaneOpts, key: string): Promise<SportFixture[]> {
  const perCompetition = await Promise.all(
    FOOTBALL_DATA_COMPETITIONS.map((code) => fetchFootballDataCompetition(opts, key, code)),
  );
  return dedupeFixtures(perCompetition.flat());
}

type TheSportsDbEvent = {
  idEvent?: string;
  strEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strLeague?: string;
  strVenue?: string;
  strTimestamp?: string;
  dateEvent?: string;
  strTime?: string;
  strStatus?: string;
  strPostponed?: string;
};

function normaliseTheSportsDbEvent(
  event: TheSportsDbEvent,
  league: TheSportsDbLeague,
): SportFixture | null {
  const idEvent = event.idEvent;
  const home = event.strHomeTeam;
  const away = event.strAwayTeam;
  if (!idEvent || !home || !away) return null;
  const status = String(event.strStatus ?? "").toUpperCase();
  if (status === "FT" || status === "CANC" || status === "ABD") return null;
  if (String(event.strPostponed ?? "").toLowerCase() === "yes") return null;

  const wall =
    (event.strTimestamp ? londonWallClockFromUtc(event.strTimestamp) : null) ??
    (event.dateEvent && event.strTime
      ? londonWallClockFromUtc(`${event.dateEvent}T${event.strTime}`)
      : null);
  if (!wall || (league.football && isFootballBlackoutKickoff(wall))) return null;

  const competition = event.strLeague ?? league.competition;
  const venue =
    typeof event.strVenue === "string" && event.strVenue.length > 0 ? event.strVenue : "TBC";
  const eventUrl = `https://www.thesportsdb.com/event/${idEvent}`;
  return {
    id: `tsdb-${idEvent}`,
    title: `${home} v ${away} - ${competition}`,
    competition,
    venue,
    kickoffLondonDate: wall.date,
    kickoffLondonTime: wall.time,
    source: { label: THESPORTSDB_LABEL, url: eventUrl },
  };
}

async function fetchTheSportsDbLeagueSeason(
  opts: LaneOpts,
  apiKey: string,
  league: TheSportsDbLeague,
  season: string,
): Promise<TheSportsDbEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsseason.php`);
  url.searchParams.set("id", league.id);
  url.searchParams.set("s", season);
  const res = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "PubmaxxingBot/0.1 (+https://pubmaxxing.com)",
    },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`TheSportsDB league ${league.id} returned ${res.status}`);
  }
  const payload = (await res.json()) as { events?: TheSportsDbEvent[] | null };
  return Array.isArray(payload.events) ? payload.events : [];
}

function theSportsDbSeasonLabel(now: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date(now));
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return "2026-2027";
  }
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

async function fetchTheSportsDbFixtures(
  opts: LaneOpts,
  apiKey: string,
  leagues: TheSportsDbLeague[],
): Promise<SportFixture[]> {
  const season = theSportsDbSeasonLabel(opts.now);
  const perLeague = await Promise.all(
    leagues.map(async (league) => {
      const events = await fetchTheSportsDbLeagueSeason(opts, apiKey, league, season);
      const fixtures: SportFixture[] = [];
      for (const event of events) {
        const fixture = normaliseTheSportsDbEvent(event, league);
        if (fixture && inWindow(fixture, opts.startMs, opts.endMs)) fixtures.push(fixture);
      }
      return fixtures;
    }),
  );
  return dedupeFixtures(perLeague.flat());
}

/**
 * Loads upcoming and in-progress fixtures for the Out refresh window. Throws when every lane
 * fails so a cron run does not wipe durable sport rows.
 */
export async function fetchLiveSportFixtures(opts: FetchLiveSportFixturesOpts): Promise<SportFixture[]> {
  const footballKey = readEnvKey("FOOTBALL_DATA_API_KEY");
  const theSportsDbKey = readEnvKey("THESPORTSDB_API_KEY") ?? "3";
  const startMs = opts.now - POINT_ROW_GRACE_MS.sport;
  const lane = (): LaneOpts => ({
    ...opts,
    startMs,
    signal: AbortSignal.timeout(SPORT_LANE_TIMEOUT_MS),
  });
  const errors: string[] = [];

  if (footballKey) {
    try {
      const [fromFootballData, nonFootball] = await Promise.all([
        fetchFootballDataFixtures(lane(), footballKey),
        fetchTheSportsDbFixtures(lane(), theSportsDbKey, THESPORTSDB_NON_FOOTBALL_LEAGUES),
      ]);
      const football = fromFootballData.filter((f) => inWindow(f, startMs, opts.endMs));
      if (football.length > 0) return dedupeFixtures([...football, ...nonFootball]);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const fromTheSportsDb = await fetchTheSportsDbFixtures(lane(), theSportsDbKey, THESPORTSDB_LEAGUES);
    if (fromTheSportsDb.length > 0) return fromTheSportsDb;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return [];
}

export const liveSportFixtureInternals = {
  normaliseFootballDataMatch,
  normaliseTheSportsDbEvent,
  londonWallClockFromUtc,
  inWindow,
  THESPORTSDB_LEAGUES,
};
