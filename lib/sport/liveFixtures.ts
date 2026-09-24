// Live sport fixture calendar for What's-On sport rows. Official-API lanes only:
// football-data.org when FOOTBALL_DATA_API_KEY is set, otherwise TheSportsDB's
// documented free tier key (override with THESPORTSDB_API_KEY). Keys are read at
// call time and never logged.

import { londonWallClockToIso } from "../../scripts/whatson/sportFixtures.mjs";
import type { SportFixture } from "../../scripts/whatson/sportFixtures.d.mts";

/** How far ahead sport refresh keeps fixtures (pub screens plan days ahead). */
export const SPORT_FIXTURE_HORIZON_MS = 21 * 24 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 8_000;

const FOOTBALL_DATA_SOURCE = {
  label: "football-data.org",
  url: "https://www.football-data.org/",
};

const THESPORTSDB_SOURCE = {
  label: "TheSportsDB",
  url: "https://www.thesportsdb.com/",
};

/** football-data.org competition codes we care about for pub screens. */
const FOOTBALL_DATA_COMPETITIONS = ["PL", "CL", "ELC"] as const;

type TheSportsDbLeague = {
  id: string;
  competition: string;
  source: { label: string; url: string };
};

const THESPORTSDB_LEAGUES: TheSportsDbLeague[] = [
  {
    id: "4328",
    competition: "English Premier League",
    source: {
      label: "Premier League",
      url: "https://www.premierleague.com/fixtures",
    },
  },
  {
    id: "4329",
    competition: "English Championship",
    source: {
      label: "EFL Championship",
      url: "https://www.efl.com/fixtures-results/",
    },
  },
  {
    id: "4480",
    competition: "UEFA Champions League",
    source: {
      label: "UEFA Champions League",
      url: "https://www.uefa.com/uefachampionsleague/fixtures-results/",
    },
  },
  {
    id: "4414",
    competition: "English Premiership Rugby",
    source: {
      label: "Premiership Rugby",
      url: "https://www.premiershiprugby.com/fixtures",
    },
  },
];

export type FetchLiveSportFixturesOpts = {
  now: number;
  endMs: number;
  fetchImpl?: typeof fetch;
};

function readEnvKey(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function londonWallClockFromUtc(isoUtc: string): { date: string; time: string } | null {
  const instant = Date.parse(isoUtc.endsWith("Z") ? isoUtc : `${isoUtc}Z`);
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

function londonWallClockFromLocalDateTime(date: string, time: string): { date: string; time: string } | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!dm || !tm) return null;
  return { date: `${dm[1]}-${dm[2]}-${dm[3]}`, time: `${tm[1]}:${tm[2]}` };
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
  if (!wall) return null;
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

async function fetchFootballDataFixtures(
  opts: FetchLiveSportFixturesOpts,
  key: string,
): Promise<SportFixture[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const dateFrom = isoDateUtc(opts.now);
  const dateTo = isoDateUtc(opts.endMs);
  const fixtures: SportFixture[] = [];

  for (const code of FOOTBALL_DATA_COMPETITIONS) {
    const url = new URL(`https://api.football-data.org/v4/competitions/${code}/matches`);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    const res = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "X-Auth-Token": key,
        "user-agent": "PubmaxxingBot/0.1 (+https://pubmaxxing.com)",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `football-data.org ${code} returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      );
    }
    const payload = (await res.json()) as { matches?: FootballDataMatch[] };
    for (const match of payload.matches ?? []) {
      const fixture = normaliseFootballDataMatch(match);
      if (fixture) fixtures.push(fixture);
    }
  }

  return dedupeFixtures(fixtures);
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
  dateEventLocal?: string;
  strTime?: string;
  strTimeLocal?: string;
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
    event.dateEventLocal && event.strTimeLocal
      ? londonWallClockFromLocalDateTime(event.dateEventLocal, event.strTimeLocal)
      : event.strTimestamp
        ? londonWallClockFromUtc(
            event.strTimestamp.endsWith("Z") ? event.strTimestamp : `${event.strTimestamp}Z`,
          )
        : event.dateEvent && event.strTime
          ? londonWallClockFromLocalDateTime(event.dateEvent, event.strTime)
          : null;
  if (!wall) return null;

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
    source: { label: league.source.label, url: eventUrl },
  };
}

async function fetchTheSportsDbLeagueSeason(
  fetchImpl: typeof fetch,
  apiKey: string,
  league: TheSportsDbLeague,
  season: string,
): Promise<TheSportsDbEvent[]> {
  const url = new URL(`https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsseason.php`);
  url.searchParams.set("id", league.id);
  url.searchParams.set("s", season);
  const res = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "PubmaxxingBot/0.1 (+https://pubmaxxing.com)",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  opts: FetchLiveSportFixturesOpts,
  apiKey: string,
): Promise<SportFixture[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const season = theSportsDbSeasonLabel(opts.now);
  const fixtures: SportFixture[] = [];

  for (const league of THESPORTSDB_LEAGUES) {
    const events = await fetchTheSportsDbLeagueSeason(fetchImpl, apiKey, league, season);
    for (const event of events) {
      const fixture = normaliseTheSportsDbEvent(event, league);
      if (fixture && inWindow(fixture, opts.now, opts.endMs)) fixtures.push(fixture);
    }
  }

  return dedupeFixtures(fixtures);
}

/**
 * Loads upcoming fixtures for the Out refresh window. Throws when every lane
 * fails so a cron run does not wipe durable sport rows.
 */
export async function fetchLiveSportFixtures(opts: FetchLiveSportFixturesOpts): Promise<SportFixture[]> {
  const startMs = opts.now;
  const footballKey = readEnvKey("FOOTBALL_DATA_API_KEY");
  const theSportsDbKey = readEnvKey("THESPORTSDB_API_KEY") ?? "3";
  const errors: string[] = [];

  if (footballKey) {
    try {
      const fromFootballData = await fetchFootballDataFixtures(opts, footballKey);
      const inWindowRows = fromFootballData.filter((f) => inWindow(f, startMs, opts.endMs));
      if (inWindowRows.length > 0) return inWindowRows;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const fromTheSportsDb = await fetchTheSportsDbFixtures(opts, theSportsDbKey);
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
  THESPORTSDB_SOURCE,
};
