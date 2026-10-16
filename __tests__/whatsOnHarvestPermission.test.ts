// scripts/whatson/quizRefresh.mjs and scripts/whatson/scrape_greene_king_sport.mjs
// used to read robots.txt themselves and fail OPEN on any fetch error (a 403, a
// 5xx, a network failure), and neither asked lib/harvest/sourcePolicy.ts. These
// pins hold the replacement: no allowed policy row means no request at all, and
// with a row, robots is read by lib/harvest/robots.ts and the archive walk stays
// on its own host.

import { afterEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ grants: new Map<string, unknown>() }));

// A test may GRANT a row the table does not hold, to prove what happens after
// permission. Nothing outside this file can do that.
vi.mock("@/lib/harvest/sourcePolicy.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harvest/sourcePolicy")>();
  return {
    ...actual,
    harvestSource: (id: string) => policy.grants.get(id) ?? actual.harvestSource(id),
  };
});

import { harvestSource } from "@/lib/harvest/sourcePolicy";
import {
  QUESTION_ONE_SOURCE_ID,
  SPEEDQUIZZING_SOURCE_ID,
  loadQuestionOne,
  loadSpeedQuizzingCoverage,
} from "@/scripts/whatson/quizRefresh.mjs";
import {
  GREENE_KING_SPORT_SOURCE_ID,
  openGreeneKingSportReader,
} from "@/scripts/whatson/scrape_greene_king_sport.mjs";

const CHALLENGE = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>";

function grant(id: string, url: string) {
  policy.grants.set(id, {
    id,
    label: id,
    url,
    kind: "venue-events",
    firstParty: true,
    access: { allowed: true, evidence: "test grant", checkedOn: "2026-10-16" },
    notes: "test grant",
  });
}

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  });
}

const fetchedUrls = (mock: ReturnType<typeof fakeFetch>) => mock.mock.calls.map(([input]) => String(input));
const noSleep = async () => {};

afterEach(() => {
  policy.grants.clear();
  vi.restoreAllMocks();
});

describe("what's-on crawlers: no allowed policy row, no request", () => {
  it("has no row today for Question One, SpeedQuizzing or Greene King sport", () => {
    expect(harvestSource(QUESTION_ONE_SOURCE_ID)).toBeUndefined();
    expect(harvestSource(SPEEDQUIZZING_SOURCE_ID)).toBeUndefined();
    expect(harvestSource(GREENE_KING_SPORT_SOURCE_ID)).toBeUndefined();
  });

  it("refuses the Question One walk before any fetch", async () => {
    const fetchImpl = fakeFetch({});
    await expect(loadQuestionOne(null, { fetchImpl, sleep: noSleep })).rejects.toThrow(
      /^REFUSED questionone-quiz-venues: .*no row/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records SpeedQuizzing coverage as refused without a fetch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fakeFetch({});
    const coverage = await loadSpeedQuizzingCoverage(null, { fetchImpl, sleep: noSleep });
    expect(coverage).toMatchObject({ totalEvents: 0, londonEvents: 0 });
    expect(coverage.refused).toMatch(/^REFUSED speedquizzing-quiz-finder/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses the Greene King sport reader before any fetch", async () => {
    const fetchImpl = fakeFetch({});
    await expect(openGreeneKingSportReader({ fetchImpl, sleep: noSleep })).rejects.toThrow(
      /^REFUSED greene-king-pub-sport: .*no row/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("what's-on crawlers: robots is read by lib/harvest/robots.ts", () => {
  const QO_ROBOTS = "https://questionone.com/robots.txt";
  const QO_VENUES = "https://questionone.com/venues/";
  const GK_ROBOTS = "https://www.greeneking.co.uk/robots.txt";

  const refusals: Array<[string, () => Response]> = [
    ["401", () => new Response("", { status: 401 })],
    ["403", () => new Response("Forbidden", { status: 403 })],
    ["a 200 challenge page", () => new Response(CHALLENGE, { status: 200 })],
    ["a 503", () => new Response("down", { status: 503 })],
  ];

  for (const [label, robots] of refusals) {
    it(`Question One refuses on ${label} and fetches no page`, async () => {
      grant(QUESTION_ONE_SOURCE_ID, QO_VENUES);
      const fetchImpl = fakeFetch({ [QO_ROBOTS]: robots });
      await expect(loadQuestionOne(null, { fetchImpl, sleep: noSleep })).rejects.toThrow(/^REFUSED /);
      expect(fetchedUrls(fetchImpl)).toEqual([QO_ROBOTS]);
    });

    it(`Greene King sport refuses on ${label} and fetches no page`, async () => {
      grant(GREENE_KING_SPORT_SOURCE_ID, "https://www.greeneking.co.uk/pubs/");
      const fetchImpl = fakeFetch({ [GK_ROBOTS]: robots });
      await expect(openGreeneKingSportReader({ fetchImpl, sleep: noSleep })).rejects.toThrow(/^REFUSED /);
      expect(fetchedUrls(fetchImpl)).toEqual([GK_ROBOTS]);
    });
  }

  it("reads a robots.txt 404 as permission, and does not follow rel=next to another host", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    grant(QUESTION_ONE_SOURCE_ID, QO_VENUES);
    const fetchImpl = fakeFetch({
      [QO_ROBOTS]: () => new Response("", { status: 404 }),
      [QO_VENUES]: () =>
        new Response('<html><head><link rel="next" href="https://evil.example/venues/page/2/"></head></html>'),
    });
    const { cards } = await loadQuestionOne(null, { fetchImpl, sleep: noSleep });
    expect(cards).toEqual([]);
    expect(fetchedUrls(fetchImpl)).toEqual([QO_ROBOTS, QO_VENUES]);
  });

  it("opens the Greene King sport reader on a robots.txt 404", async () => {
    grant(GREENE_KING_SPORT_SOURCE_ID, "https://www.greeneking.co.uk/pubs/");
    const fetchImpl = fakeFetch({ [GK_ROBOTS]: () => new Response("", { status: 404 }) });
    await expect(openGreeneKingSportReader({ fetchImpl, sleep: noSleep })).resolves.toBeTypeOf("function");
    expect(fetchedUrls(fetchImpl)).toEqual([GK_ROBOTS]);
  });
});
