// scripts/whatson/quizRefresh.mjs and scripts/whatson/scrape_greene_king_sport.mjs
// used to read robots.txt themselves and fail OPEN on any fetch error (a 403, a
// 5xx, a network failure), and neither asked lib/harvest/sourcePolicy.ts. These
// pins hold the replacement: no allowed policy row means no request at all, and
// with a row, robots is read by lib/harvest/robots.ts and the directory walk
// stays on its own host.

import { afterEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ grants: new Map<string, unknown>(), removed: new Set<string>() }));

// A test may GRANT a row the table does not hold, to prove what happens after
// permission, or REMOVE one it does hold, to prove what happens without it.
// Nothing outside this file can do either.
vi.mock("@/lib/harvest/sourcePolicy.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harvest/sourcePolicy")>();
  return {
    ...actual,
    harvestSource: (id: string) =>
      policy.removed.has(id) ? undefined : (policy.grants.get(id) ?? actual.harvestSource(id)),
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
  QUESTION_ONE_MAX_PAGES,
  questionOneDirectoryPageUrl,
} from "@/scripts/whatson/questionOneDirectory.mjs";
import {
  GREENE_KING_SPORT_SOURCE_ID,
  openGreeneKingSportReader,
} from "@/scripts/whatson/scrape_greene_king_sport.mjs";
import {
  QUESTION_ONE_SOURCE_ID as SERVER_QUESTION_ONE_SOURCE_ID,
  refreshQuestionOneQuiz,
  refreshWhatsOnListings,
} from "@/lib/whatsOnRefresh.server";
import type { WhatsOnListingStore } from "@/lib/whatsOnListingStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

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
  policy.removed.clear();
  vi.restoreAllMocks();
});

// The directory JSON as WordPress serves it: the list, plus the page count.
function directoryPage(records: unknown[], totalPages: number) {
  return () =>
    new Response(JSON.stringify(records), {
      headers: { "content-type": "application/json", "x-wp-totalpages": String(totalPages) },
    });
}

describe("what's-on crawlers: no allowed policy row, no request", () => {
  it("allows Question One (captain, 28 Oct 2026) and holds no row for SpeedQuizzing or Greene King sport", () => {
    expect(harvestSource(QUESTION_ONE_SOURCE_ID)).toMatchObject({
      kind: "quiz-directory",
      firstParty: true,
      url: "https://questionone.com/wp-json/wp/v2/venues",
      access: { allowed: true, checkedOn: "2026-10-28" },
    });
    expect(harvestSource(SPEEDQUIZZING_SOURCE_ID)).toBeUndefined();
    expect(harvestSource(GREENE_KING_SPORT_SOURCE_ID)).toBeUndefined();
  });

  it("refuses the Question One walk before any fetch when the row is missing", async () => {
    policy.removed.add(QUESTION_ONE_SOURCE_ID);
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
  const QO_API = "https://questionone.com/wp-json/wp/v2/venues";
  const GK_ROBOTS = "https://www.greeneking.co.uk/robots.txt";

  const refusals: Array<[string, () => Response]> = [
    ["401", () => new Response("", { status: 401 })],
    ["403", () => new Response("Forbidden", { status: 403 })],
    ["a 200 challenge page", () => new Response(CHALLENGE, { status: 200 })],
    ["a 503", () => new Response("down", { status: 503 })],
  ];

  for (const [label, robots] of refusals) {
    it(`Question One refuses on ${label} and fetches no page`, async () => {
      grant(QUESTION_ONE_SOURCE_ID, QO_API);
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

  it("reads a robots.txt 404 as permission, and reads every directory page on the row's own url", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    grant(QUESTION_ONE_SOURCE_ID, QO_API);
    const page1 = questionOneDirectoryPageUrl(QO_API, 1);
    const page2 = questionOneDirectoryPageUrl(QO_API, 2);
    const fetchImpl = fakeFetch({
      [QO_ROBOTS]: () => new Response("", { status: 404 }),
      [page1]: directoryPage([], 2),
      [page2]: directoryPage([], 2),
    });
    const { cards } = await loadQuestionOne(null, { fetchImpl, sleep: noSleep });
    expect(cards).toEqual([]);
    expect(fetchedUrls(fetchImpl)).toEqual([QO_ROBOTS, page1, page2]);
    expect(page1.startsWith(`${QO_API}?`)).toBe(true);
  });

  it("opens the Greene King sport reader on a robots.txt 404", async () => {
    grant(GREENE_KING_SPORT_SOURCE_ID, "https://www.greeneking.co.uk/pubs/");
    const fetchImpl = fakeFetch({ [GK_ROBOTS]: () => new Response("", { status: 404 }) });
    await expect(openGreeneKingSportReader({ fetchImpl, sleep: noSleep })).resolves.toBeTypeOf("function");
    expect(fetchedUrls(fetchImpl)).toEqual([GK_ROBOTS]);
  });
});

// The Vercel cron (GET /api/cron/refresh-whats-on) used to walk Question One's
// archive with a bare fetch: no policy row, no robots.txt. It now goes through
// the same door as the CLI.
describe("what's-on cron: the quiz lane asks the policy table first", () => {
  const QO_ROBOTS = "https://questionone.com/robots.txt";
  const QO_API = "https://questionone.com/wp-json/wp/v2/venues";
  const NOW = Date.parse("2026-10-16T20:00:00.000Z");

  function memoryStore(stored: Map<string, WhatsOnRow[]>): WhatsOnListingStore {
    return {
      async replaceKind(kind, next) {
        stored.set(kind, next);
        return { written: next.length };
      },
      async readAll() {
        return { rows: [...stored.values()].flat(), generatedAt: null };
      },
      async readGeneratedAt() {
        return { generatedAt: null };
      },
    };
  }

  it("reads under the same row id as the CLI", () => {
    expect(SERVER_QUESTION_ONE_SOURCE_ID).toBe(QUESTION_ONE_SOURCE_ID);
  });

  it("refuses before any fetch when the table has no row", async () => {
    policy.removed.add(QUESTION_ONE_SOURCE_ID);
    const fetchImpl = fakeFetch({});
    await expect(refreshQuestionOneQuiz(NOW, { fetchImpl })).rejects.toThrow(
      /^REFUSED questionone-quiz-venues: .*no row/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports the quiz kind as refused, keeps its stored rows and does not fail the run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    policy.removed.add(QUESTION_ONE_SOURCE_ID);
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const kept = { id: "quiz-kept", kind: "quiz" } as WhatsOnRow;
    const stored = new Map<string, WhatsOnRow[]>([["quiz", [kept]]]);
    const store = memoryStore(stored);
    const result = await refreshWhatsOnListings({
      now: NOW,
      store,
      providers: [{ name: "ticketmaster", isConfigured: () => false, fetchTonight: async () => [] }],
      refreshers: { deal: async () => [], music: async () => [], sport: async () => [] },
    });
    expect(globalFetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.kinds).toContainEqual({
      name: "quiz",
      kind: "quiz",
      rows: 0,
      refused: expect.stringMatching(/^REFUSED questionone-quiz-venues: .*no row/),
    });
    expect(stored.get("quiz")).toEqual([kept]);
  });

  it("with the row, asks robots.txt first and reads the whole directory on the row's own url", async () => {
    const page1 = questionOneDirectoryPageUrl(QO_API, 1);
    const page2 = questionOneDirectoryPageUrl(QO_API, 2);
    const fetchImpl = fakeFetch({
      [QO_ROBOTS]: () => new Response("User-agent: *\nDisallow: /wp-admin/\n"),
      [page1]: directoryPage([], 2),
      [page2]: directoryPage([], 2),
    });
    await expect(refreshQuestionOneQuiz(NOW, { fetchImpl })).resolves.toEqual([]);
    expect(fetchedUrls(fetchImpl)).toEqual([QO_ROBOTS, page1, page2]);
  });

  it("refuses a part read: a directory longer than the page cap keeps the stored quiz rows", async () => {
    const routes: Record<string, () => Response> = {
      [QO_ROBOTS]: () => new Response("", { status: 404 }),
    };
    for (let page = 1; page <= QUESTION_ONE_MAX_PAGES; page += 1) {
      routes[questionOneDirectoryPageUrl(QO_API, page)] = directoryPage([], QUESTION_ONE_MAX_PAGES + 1);
    }
    const fetchImpl = fakeFetch(routes);
    vi.stubGlobal("fetch", fetchImpl);
    const kept = { id: "quiz-kept", kind: "quiz" } as WhatsOnRow;
    const stored = new Map<string, WhatsOnRow[]>([["quiz", [kept]]]);
    try {
      const result = await refreshWhatsOnListings({
        now: NOW,
        store: memoryStore(stored),
        providers: [{ name: "ticketmaster", isConfigured: () => false, fetchTonight: async () => [] }],
        refreshers: { deal: async () => [], music: async () => [], sport: async () => [] },
      });
      expect(result.ok).toBe(false);
      expect(result.kinds).toContainEqual({
        name: "quiz",
        kind: "quiz",
        rows: 0,
        error: expect.stringMatching(/more than 5 pages/),
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(stored.get("quiz")).toEqual([kept]);
    expect(fetchedUrls(fetchImpl)).toHaveLength(1 + QUESTION_ONE_MAX_PAGES);
  });

  it("with a row, fetches no page when robots.txt refuses", async () => {
    const fetchImpl = fakeFetch({ [QO_ROBOTS]: () => new Response("Forbidden", { status: 403 }) });
    await expect(refreshQuestionOneQuiz(NOW, { fetchImpl })).rejects.toThrow(/^REFUSED /);
    expect(fetchedUrls(fetchImpl)).toEqual([QO_ROBOTS]);
  });
});
