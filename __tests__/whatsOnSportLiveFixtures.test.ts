import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { filterNotPast } from "@/lib/whatsOn";
import {
  fetchLiveSportFixtures,
  liveSportFixtureInternals,
  SPORT_FIXTURE_HORIZON_MS,
} from "@/lib/sport/liveFixtures";
import { buildSportFixtureRows } from "../scripts/whatson/sportFixtures.mjs";

type TheSportsDbEvent = Record<string, unknown>;

const PL_SAMPLE = JSON.parse(
  readFileSync(join(process.cwd(), "__tests__/fixtures/sport/thesportsdb-eventsseason-pl.json"), "utf8"),
);

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

describe("live sport fixtures", () => {
  it("maps recorded TheSportsDB events and drops finished fixtures", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixtures = (PL_SAMPLE.events ?? [])
      .map((event: TheSportsDbEvent) => liveSportFixtureInternals.normaliseTheSportsDbEvent(event, league))
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
    const fixture = liveSportFixtureInternals.normaliseTheSportsDbEvent(PL_SAMPLE.events[0], league);
    expect(fixture?.source).toEqual({
      label: "TheSportsDB",
      url: "https://www.thesportsdb.com/event/2494052",
    });
  });

  it("reads kickoff from UTC, not the venue's local clock", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES.find((l) => l.id === "4480")!;
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
    expect(liveSportFixtureInternals.normaliseTheSportsDbEvent(madrid, league)).toMatchObject({
      kickoffLondonDate: "2026-10-21",
      kickoffLondonTime: "20:00",
    });

    expect(
      liveSportFixtureInternals.normaliseTheSportsDbEvent({ ...madrid, strTimestamp: undefined }, league),
    ).toMatchObject({ kickoffLondonDate: "2026-10-21", kickoffLondonTime: "20:00" });

    expect(
      liveSportFixtureInternals.normaliseTheSportsDbEvent(
        { ...madrid, strTimestamp: "2026-10-21T19:00:00+00:00" },
        league,
      ),
    ).toMatchObject({ kickoffLondonTime: "20:00" });
  });

  it("fetches every league at once under one lane deadline", async () => {
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "");
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

  it("keeps a fixture that kicked off before the run while it is still being served", async () => {
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "");
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

  it("filters fixtures outside the refresh horizon", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixture = liveSportFixtureInternals.normaliseTheSportsDbEvent(PL_SAMPLE.events[0], league);
    expect(fixture).not.toBeNull();
    expect(
      liveSportFixtureInternals.inWindow(fixture!, NOW, NOW + SPORT_FIXTURE_HORIZON_MS),
    ).toBe(true);
    expect(liveSportFixtureInternals.inWindow(fixture!, NOW, NOW + 60_000)).toBe(false);
  });

  it("builds servable sport rows from recorded fixtures", () => {
    const league = liveSportFixtureInternals.THESPORTSDB_LEAGUES[0];
    const fixtures = [liveSportFixtureInternals.normaliseTheSportsDbEvent(PL_SAMPLE.events[0], league)!];
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
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "test-key");
    await expect(
      fetchLiveSportFixtures({
        now: NOW,
        endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
        fetchImpl,
      }),
    ).rejects.toThrow(/football-data\.org|TheSportsDB/);
    vi.unstubAllEnvs();
  });

  it("uses TheSportsDB when football-data is not configured", async () => {
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("thesportsdb.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => PL_SAMPLE,
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const fixtures = await fetchLiveSportFixtures({
      now: NOW,
      endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
      fetchImpl,
    });
    expect(fixtures.length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });
});
