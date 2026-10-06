import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { dedupeRows, filterNotPast } from "@/lib/whatsOn";
import {
  fetchLiveSportFixtures,
  liveSportFixtureInternals,
  SPORT_FIXTURE_HORIZON_MS,
} from "@/lib/sport/liveFixtures";
import { buildSportFixtureRows } from "../scripts/whatson/sportFixtures.mjs";
import { defined } from "@/__tests__/helpers/defined";

type TheSportsDbEvent = Record<string, unknown>;

const PL_SAMPLE = JSON.parse(
  readFileSync(join(process.cwd(), "__tests__/fixtures/sport/thesportsdb-eventsseason-pl.json"), "utf8"),
);

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

const LICENSED_TSDB_KEY = "paid-test-key";

function stubSportKeys(footballKey = "", sportsDbKey = LICENSED_TSDB_KEY) {
  vi.stubEnv("FOOTBALL_DATA_API_KEY", footballKey);
  vi.stubEnv("THESPORTSDB_API_KEY", sportsDbKey);
}

describe("live sport fixtures", () => {
  it("maps recorded TheSportsDB events and drops finished fixtures", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixtures = (PL_SAMPLE.events ?? [])
      .map((event: TheSportsDbEvent) => liveSportFixtureInternals.normaliseTheSportsDbEvent(event, defined(league)))
      .filter(Boolean);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      id: "tsdb-2494052",
      kickoffLondonDate: "2026-10-10",
      kickoffLondonTime: "12:30",
    });
  });

  it("cites TheSportsDB, not the league, as the fixture source", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixture = liveSportFixtureInternals.normaliseTheSportsDbEvent(PL_SAMPLE.events[0], defined(league));
    expect(fixture?.source).toEqual({
      label: "TheSportsDB",
      url: "https://www.thesportsdb.com/event/2494052",
    });
  });

  it("reads kickoff from UTC, not the venue's local clock", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const madrid = {
      idEvent: "9000001",
      strHomeTeam: "Real Madrid",
      strAwayTeam: "Arsenal",
      strLeague: "UEFA Champions League",
      strTimestamp: "2026-10-21T19:00:00",
      dateEvent: "2026-10-21",
      dateEventLocal: "2026-10-21",
      strTime: "19:00:00",
      strTimeLocal: "21:00:00",
      strStatus: "NS",
    };
    expect(liveSportFixtureInternals.normaliseTheSportsDbEvent(madrid, defined(league))).toMatchObject({
      kickoffLondonDate: "2026-10-21",
      kickoffLondonTime: "20:00",
    });

    expect(
      liveSportFixtureInternals.normaliseTheSportsDbEvent({ ...madrid, strTimestamp: undefined }, defined(league)),
    ).toMatchObject({ kickoffLondonDate: "2026-10-21", kickoffLondonTime: "20:00" });

    expect(
      liveSportFixtureInternals.normaliseTheSportsDbEvent(
        { ...madrid, strTimestamp: "2026-10-21T19:00:00+00:00" },
        defined(league),
      ),
    ).toMatchObject({ kickoffLondonTime: "20:00" });
  });

  it("fetches every TheSportsDB league at once under one lane deadline", async () => {
    stubSportKeys("", LICENSED_TSDB_KEY);
    let inFlight = 0;
    let peak = 0;
    const signals = new Set<AbortSignal | null | undefined>();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.add(init?.signal);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, status: 200, json: async () => ({ events: [] }) } as Response;
    });

    await fetchLiveSportFixtures({ now: NOW, endMs: NOW + SPORT_FIXTURE_HORIZON_MS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(liveSportFixtureInternals.THESPORTSDB_LEAGUES.length);
    expect(peak).toBe(liveSportFixtureInternals.THESPORTSDB_LEAGUES.length);
    expect(signals.size).toBe(1);
    vi.unstubAllEnvs();
  });

  it("gives TheSportsDB rugby its own deadline when football-data times out", async () => {
    stubSportKeys("test-key", LICENSED_TSDB_KEY);
    const controllers = new Map<AbortSignal, AbortController>();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controllers.set(controller.signal, controller);
      return controller.signal;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      if (String(input).includes("football-data.org")) {
        controllers.get(signal)?.abort(new DOMException("timed out", "TimeoutError"));
        throw signal.reason;
      }
      if (signal.aborted) throw signal.reason;
      const payload = String(input).includes("id=4414") ? PL_SAMPLE : { events: [] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["tsdb-2494052"]);
    warn.mockRestore();
    timeout.mockRestore();
    vi.unstubAllEnvs();
  });

  it("keeps a fixture that kicked off before the run while it is still being served", async () => {
    stubSportKeys("", LICENSED_TSDB_KEY);
    const kickoff = (msAgo: number, idEvent: string) => ({
      idEvent,
      strHomeTeam: `Home ${idEvent}`,
      strAwayTeam: `Away ${idEvent}`,
      strLeague: "English Premiership Rugby",
      strTimestamp: new Date(NOW - msAgo).toISOString(),
      strStatus: "1H",
    });
    const events = [kickoff(60 * 60 * 1000, "in-progress"), kickoff(3 * 60 * 60 * 1000, "over")];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const payload = String(input).includes("id=4414") ? { events } : { events: [] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    });

    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["tsdb-in-progress"]);
    vi.unstubAllEnvs();
  });

  it("drops football kicking off in the Saturday 3pm blackout but keeps rugby", () => {
    const [rugby] = liveSportFixtureInternals.THESPORTSDB_LEAGUES;
    const match = (id: number, utcDate: string) => ({
      id,
      utcDate,
      status: "TIMED",
      homeTeam: { name: "Home" },
      awayTeam: { name: "Away" },
    });

    expect(liveSportFixtureInternals.normaliseFootballDataMatch(match(1, "2026-10-10T14:00:00Z"))).toBeNull();
    expect(
      liveSportFixtureInternals.normaliseFootballDataMatch(match(2, "2026-10-10T16:30:00Z")),
    ).toMatchObject({ kickoffLondonTime: "17:30" });
    expect(
      liveSportFixtureInternals.normaliseFootballDataMatch(match(3, "2026-10-11T14:00:00Z")),
    ).toMatchObject({ kickoffLondonTime: "15:00" });
    expect(
      liveSportFixtureInternals.normaliseTheSportsDbEvent(
        {
          idEvent: "rugby-3pm",
          strHomeTeam: "Home",
          strAwayTeam: "Away",
          strTimestamp: "2026-10-10T14:00:00",
          strStatus: "NS",
        },
        defined(rugby),
      ),
    ).toMatchObject({ kickoffLondonTime: "15:00" });
  });

  it("keeps TheSportsDB rugby alongside football-data football", async () => {
    stubSportKeys("test-key", LICENSED_TSDB_KEY);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("football-data.org")) {
        const matches = url.includes("/PL/")
          ? [{
            id: 77,
            utcDate: "2026-10-07T19:00:00Z",
            status: "TIMED",
            homeTeam: { name: "Arsenal" },
            awayTeam: { name: "Spurs" },
            competition: { name: "Premier League" },
          }]
          : [];
        return { ok: true, status: 200, json: async () => ({ matches }) } as Response;
      }
      if (url.includes("id=4414")) {
        const events = [{
          idEvent: "rugby-1",
          strHomeTeam: "Harlequins",
          strAwayTeam: "Saracens",
          strTimestamp: "2026-10-10T14:00:00",
          strStatus: "NS",
        }];
        return { ok: true, status: 200, json: async () => ({ events }) } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["fd-77", "tsdb-rugby-1"]);
    vi.unstubAllEnvs();
  });

  it("keeps football-data football when the TheSportsDB rugby read fails", async () => {
    stubSportKeys("test-key", LICENSED_TSDB_KEY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("football-data.org")) {
        const matches = url.includes("/PL/")
          ? [{
            id: 77,
            utcDate: "2026-10-07T19:00:00Z",
            status: "TIMED",
            homeTeam: { name: "Arsenal" },
            awayTeam: { name: "Spurs" },
            competition: { name: "Premier League" },
          }]
          : [];
        return { ok: true, status: 200, json: async () => ({ matches }) } as Response;
      }
      return { ok: false, status: 503, json: async () => ({}), text: async () => "down" } as Response;
    });

    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["fd-77"]);
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("keeps the football-data competitions that answered when one fails", async () => {
    stubSportKeys("test-key", LICENSED_TSDB_KEY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/CL/")) {
        return { ok: false, status: 429, json: async () => ({}), text: async () => "" } as Response;
      }
      if (url.includes("football-data.org")) {
        const matches = url.includes("/PL/")
          ? [{
            id: 77,
            utcDate: "2026-10-07T19:00:00Z",
            status: "TIMED",
            homeTeam: { name: "Arsenal" },
            awayTeam: { name: "Spurs" },
            competition: { name: "Premier League" },
          }]
          : [];
        return { ok: true, status: 200, json: async () => ({ matches }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ events: [] }) } as Response;
    });

    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["fd-77"]);
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("keeps every fixture a pub could show at the same kickoff", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixtures = ["9100001", "9100002"].map((idEvent, i) =>
      liveSportFixtureInternals.normaliseTheSportsDbEvent(
        {
          idEvent,
          strHomeTeam: `Home ${i}`,
          strAwayTeam: `Away ${i}`,
          strTimestamp: "2026-10-07T19:00:00",
          strStatus: "NS",
        },
        defined(league),
      )!,
    );
    const rows = buildSportFixtureRows({
      attributeRows: [
        {
          id: "sport-attr-gk-test",
          placeName: "Test Pub",
          kind: "sport",
          source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/test" },
          observedAt: "2026-09-24T00:00:00.000Z",
        },
      ],
      fixtures,
      observedAt: "2026-10-05T12:00:00.000Z",
    });
    expect(dedupeRows(rows as never)).toHaveLength(2);
  });

  it("filters fixtures outside the refresh horizon", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixture = liveSportFixtureInternals.normaliseTheSportsDbEvent(PL_SAMPLE.events[0], defined(league));
    expect(fixture).not.toBeNull();
    expect(
      liveSportFixtureInternals.inWindow(fixture!, NOW, NOW + SPORT_FIXTURE_HORIZON_MS),
    ).toBe(true);
    expect(liveSportFixtureInternals.inWindow(fixture!, NOW, NOW + 60_000)).toBe(false);
  });

  it("builds servable sport rows from recorded fixtures", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixtures = [liveSportFixtureInternals.normaliseTheSportsDbEvent(PL_SAMPLE.events[0], defined(league))!];
    const rows = buildSportFixtureRows({
      attributeRows: [
        {
          id: "sport-attr-gk-test",
          placeName: "Test Pub",
          kind: "sport",
          source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/test" },
          observedAt: "2026-09-24T00:00:00.000Z",
        },
      ],
      fixtures,
      observedAt: "2026-09-24T12:00:00.000Z",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(filterNotPast(rows, NOW).length).toBeGreaterThan(0);
  });

  it("throws when every upstream lane fails", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => "down",
      }) as Response,
    );
    stubSportKeys("test-key", LICENSED_TSDB_KEY);
    await expect(
      fetchLiveSportFixtures({
        now: NOW,
        endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
        fetchImpl,
      }),
    ).rejects.toThrow(/football-data\.org|TheSportsDB/);
    vi.unstubAllEnvs();
  });

  it("lists no football without FOOTBALL_DATA_API_KEY and still serves TheSportsDB rugby with a licensed key", async () => {
    stubSportKeys("", LICENSED_TSDB_KEY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rugby = {
      idEvent: "rugby-1",
      strHomeTeam: "Harlequins",
      strAwayTeam: "Saracens",
      strTimestamp: "2026-10-10T14:00:00",
      strStatus: "NS",
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("thesportsdb.com")) throw new Error(`unexpected fetch ${url}`);
      const payload = url.includes("id=4414") ? { events: [rugby] } : PL_SAMPLE;
      return { ok: true, status: 200, json: async () => payload } as Response;
    });

    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["tsdb-rugby-1"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("FOOTBALL_DATA_API_KEY"));
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("lists no fixtures when no licensed keys are configured", async () => {
    stubSportKeys("", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("FOOTBALL_DATA_API_KEY"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("THESPORTSDB_API_KEY"));
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("does not call TheSportsDB when only the public test key is configured", async () => {
    stubSportKeys("", "3");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("public test key"));
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});
