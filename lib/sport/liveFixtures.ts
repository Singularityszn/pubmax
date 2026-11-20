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

/** football-data.org competition codes we care about for pub screens. */
const FOOTBALL_DATA_COMPETITIONS = ["PL", "CL", "ELC"] as const;

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

export function dedupeFixtures(fixtures: SportFixture[]): SportFixture[] {
  const seen = new Set<string>();
  const out: SportFixture[] = [];
  for (const fixture of fixtures) {
    const title = fixture.title.toLowerCase().replace(/\b(?:fc|afc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const key = `${fixture.kickoffLondonDate}|${fixture.kickoffLondonTime}|${title}`;
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

async function settleLeagueReads(
  reads: Promise<SportFixture[]>[],
  opts: Pick<LaneOpts, "startMs" | "endMs">,
): Promise<SportFixture[]> {
  const settled = await Promise.allSettled(reads);
  const failures = settled.flatMap((result) =>
    result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
      : [],
  );
  const fixtures = dedupeFixtures(
    settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .filter((fixture) => inWindow(fixture, opts.startMs, opts.endMs)),
  );
  if (failures.length > 0 && fixtures.length === 0) throw new Error(failures.join("; "));
  if (failures.length > 0) {
    console.warn("[sport] fixture league read failed; serving the other leagues:", failures.join("; "));
  }
  return fixtures;
}

async function fetchFootballDataFixtures(opts: LaneOpts, key: string): Promise<SportFixture[]> {
  return settleLeagueReads(
    FOOTBALL_DATA_COMPETITIONS.map((code) => fetchFootballDataCompetition(opts, key, code)),
    opts,
  );
}

export async function fetchLiveSportFixtures(opts: FetchLiveSportFixturesOpts): Promise<SportFixture[]> {
  const footballKey = readEnvKey("FOOTBALL_DATA_API_KEY");
  if (!footballKey) {
    console.warn("[sport] FOOTBALL_DATA_API_KEY is not set; no football fixtures are listed.");
    return [];
  }
  return fetchFootballDataFixtures({
    ...opts,
    startMs: opts.now - POINT_ROW_GRACE_MS.sport,
    signal: AbortSignal.timeout(SPORT_LANE_TIMEOUT_MS),
  }, footballKey);
}

export const liveSportFixtureInternals = {
  normaliseFootballDataMatch,
  londonWallClockFromUtc,
  inWindow,
};
