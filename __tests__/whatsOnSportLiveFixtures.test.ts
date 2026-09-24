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

const NOW = Date.parse("2026-09-24T12:00:00.000Z");

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
