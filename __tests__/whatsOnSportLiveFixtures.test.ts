import { describe, expect, it, vi } from "vitest";

import { dedupeRows, filterNotPast } from "@/lib/whatsOn";
import {
  fetchLiveSportFixtures,
  liveSportFixtureInternals,
  SPORT_FIXTURE_HORIZON_MS,
} from "@/lib/sport/liveFixtures";
import { buildSportFixtureRows } from "../scripts/whatson/sportFixtures.mjs";
import { fetchOpenFootballFixtures } from "@/lib/sport/openFootballFixtures";

const FOOTBALL_MATCH = {
  id: 77,
  homeTeam: { name: "Arsenal" },
  awayTeam: { name: "Spurs" },
  utcDate: "2026-10-07T19:00:00Z",
  status: "SCHEDULED",
  competition: { name: "Premier League" },
};

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

function stubSportKeys(footballKey = "", sportsDbKey = "paid-test-key") {
  vi.stubEnv("FOOTBALL_DATA_API_KEY", footballKey);
  vi.stubEnv("THESPORTSDB_API_KEY", sportsDbKey);
}

describe("live sport fixtures", () => {
  it("retains an ongoing OpenFootball match until the sport grace period ends", async () => {
    const now = Date.parse("2026-11-22T15:00:00Z");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).includes("/commits?")
        ? [{ sha: "a".repeat(40), commit: { committer: { date: "2026-11-22T13:00:00Z" } } }]
        : { matches: [
          { date: "2026-11-22", time: "14:00", team1: "Arsenal", team2: "Chelsea" },
          { date: "2026-11-22", time: "12:00", team1: "A", team2: "B" },
          { date: "2026-11-22", time: "14:00", team1: "C", team2: "D", score: { ft: [1, 0] } },
          { date: "2026-11-28", time: "15:00", team1: "E", team2: "F" },
        ] },
    )));
    const fixtures = await fetchOpenFootballFixtures({ now, endMs: now + SPORT_FIXTURE_HORIZON_MS, fetchImpl });
    expect(fixtures.map((fixture) => fixture.title)).toEqual(["Arsenal v Chelsea - Premier League"]);
    expect(await fetchOpenFootballFixtures({ now: Date.parse("2026-11-22T16:31:00Z"), endMs: now + SPORT_FIXTURE_HORIZON_MS, fetchImpl })).toEqual([]);
  });
  it("uses recently updated fixtures and excludes blackout and completed matches", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ sha: "a".repeat(40), commit: { committer: { date: "2026-10-05T10:00:00Z" } } }])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ matches: [
        { date: "2026-10-09", time: "20:00", team1: "Arsenal", team2: "Chelsea" },
        { date: "2026-10-10", time: "15:00", team1: "A", team2: "B" },
        { date: "2026-10-09", time: "19:00", team1: "C", team2: "D", score: { ft: [1, 0] } },
      ] })));
    const fixtures = await fetchOpenFootballFixtures({ now: NOW, endMs: NOW + SPORT_FIXTURE_HORIZON_MS, fetchImpl });
    expect(fixtures.map((fixture) => fixture.title)).toEqual(["Arsenal v Chelsea - Premier League"]);
  });

  it("does not serve a source that has not been updated recently", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ sha: "a".repeat(40), commit: { committer: { date: "2026-09-01T10:00:00Z" } } }])));
    expect(await fetchOpenFootballFixtures({ now: NOW, endMs: NOW + SPORT_FIXTURE_HORIZON_MS, fetchImpl })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("expires stored OpenFootball rows when their source update is too old", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [{ id: "sport-one", kind: "sport", placeName: "Pub", source: { url: "https://example.com" }, observedAt: "2026-09-01T10:00:00Z" }],
      fixtures: [{ id: "of-fixture", title: "Arsenal v Chelsea", competition: "Premier League", venue: "TBC", kickoffLondonDate: "2026-10-09", kickoffLondonTime: "20:00", source: { label: "OpenFootball", url: "https://example.com" }, sourceUpdatedAt: "2026-10-05T10:00:00Z" }],
      observedAt: "2026-10-05T12:00:00Z",
    });
    expect(filterNotPast(rows, NOW)).toHaveLength(1);
    expect(filterNotPast(rows, NOW + 49 * 60 * 60 * 1000)).toHaveLength(0);
  });
  it("drops finished, cancelled and postponed football matches", () => {
    for (const status of ["FINISHED", "CANCELLED", "POSTPONED"]) {
      expect(liveSportFixtureInternals.normaliseFootballDataMatch({ ...FOOTBALL_MATCH, status })).toBeNull();
    }
  });

  it("cites football-data.org as the fixture source", () => {
    const fixture = liveSportFixtureInternals.normaliseFootballDataMatch(FOOTBALL_MATCH);
    expect(fixture?.source).toEqual({
      label: "football-data.org",
      url: "https://www.football-data.org/",
    });
  });

  it("reads kickoff from UTC, not the venue's local clock", () => {
    for (const utcDate of ["2026-10-21T19:00:00", "2026-10-21T19:00:00Z", "2026-10-21T19:00:00+00:00"]) {
      expect(liveSportFixtureInternals.normaliseFootballDataMatch({ ...FOOTBALL_MATCH, utcDate })).toMatchObject({
        kickoffLondonDate: "2026-10-21",
        kickoffLondonTime: "20:00",
      });
    }
  });

  it("fetches football competitions under one lane deadline", async () => {
    stubSportKeys("test-key");
    const signals = new Set<AbortSignal | null | undefined>();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.add(init?.signal);
      return new Response(JSON.stringify({ matches: [] }));
    });

    expect(await fetchLiveSportFixtures({ now: NOW, endMs: NOW + SPORT_FIXTURE_HORIZON_MS, fetchImpl })).toEqual([]);
    expect(signals.size).toBe(1);
    expect([...signals][0]).toBeInstanceOf(AbortSignal);
    vi.unstubAllEnvs();
  });

  it("keeps a fixture that kicked off before the run while it is still being served", async () => {
    stubSportKeys("test-key");
    const matches = [
      { ...FOOTBALL_MATCH, id: 1, utcDate: "2026-10-05T11:00:00Z", status: "IN_PLAY" },
      { ...FOOTBALL_MATCH, id: 2, utcDate: "2026-10-05T09:00:00Z", status: "IN_PLAY" },
    ];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({ matches: String(input).includes("/PL/") ? matches : [] })),
    );
    const fixtures = await fetchLiveSportFixtures({ now: NOW, endMs: NOW + SPORT_FIXTURE_HORIZON_MS, fetchImpl });
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["fd-1"]);
    vi.unstubAllEnvs();
  });

  it("drops football kicking off in the Saturday 3pm blackout", () => {
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
  });

  it("ignores TheSportsDB fixtures alongside permitted football", async () => {
    stubSportKeys("test-key", "paid-test-key");
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
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["fd-77"]);
    vi.unstubAllEnvs();
  });

  it("keeps the football-data competitions that answered when one fails", async () => {
    stubSportKeys("test-key", "paid-test-key");
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
    const fixtures = [1, 2].map((id) => liveSportFixtureInternals.normaliseFootballDataMatch({
      ...FOOTBALL_MATCH,
      id,
      homeTeam: { name: `Home ${id}` },
      awayTeam: { name: `Away ${id}` },
    })!);
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
    const fixture = liveSportFixtureInternals.normaliseFootballDataMatch(FOOTBALL_MATCH);
    expect(fixture).not.toBeNull();
    expect(
      liveSportFixtureInternals.inWindow(fixture!, NOW, NOW + SPORT_FIXTURE_HORIZON_MS),
    ).toBe(true);
    expect(liveSportFixtureInternals.inWindow(fixture!, NOW, NOW + 60_000)).toBe(false);
  });

  it("builds servable sport rows from permitted fixtures", () => {
    const fixtures = [liveSportFixtureInternals.normaliseFootballDataMatch(FOOTBALL_MATCH)!];
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
    stubSportKeys("test-key", "paid-test-key");
    await expect(
      fetchLiveSportFixtures({
        now: NOW,
        endMs: NOW + SPORT_FIXTURE_HORIZON_MS,
        fetchImpl,
      }),
    ).rejects.toThrow(/football-data\.org/);
    vi.unstubAllEnvs();
  });

  it("lists no fixtures when only a TheSportsDB key is configured", async () => {
    stubSportKeys();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    expect(await fetchLiveSportFixtures({ now: NOW, endMs: NOW + SPORT_FIXTURE_HORIZON_MS, fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
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
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});
