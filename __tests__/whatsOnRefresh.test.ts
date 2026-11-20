import { describe, expect, it, vi } from "vitest";

import {
  refreshOfficialWhatsOnListings,
  refreshWhatsOnListings,
} from "@/lib/whatsOnRefresh.server";
import type { WhatsOnListingStore } from "@/lib/whatsOnListingStore";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { OutLiveProvider } from "@/lib/out/loadOut";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import type { VenueRef } from "@/lib/venueIndex";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-08-24T20:00:00.000Z");
const GENERATED = "2026-08-24T20:00:00.000Z";
const LEXINGTON: VenueRef = {
  id: "venue-1137z1c",
  name: "The Lexington",
  borough: "Islington",
  lat: 51.5326,
  lng: -0.1119,
};

function eventRow(id: string, sourceLabel = "Ticketmaster"): WhatsOnRow {
  return {
    id,
    placeName: "Jazz Cafe",
    kind: "event",
    startsAt: "2026-08-24T19:00:00.000Z",
    endsAt: "2026-08-24T22:00:00.000Z",
    title: "Live jazz",
    source: { label: sourceLabel, url: `https://www.ticketmaster.co.uk/event/${id}` },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
    sourceId: id,
  };
}

function quizRow(id: string): WhatsOnRow {
  return {
    id,
    placeName: "The Quiz Pub",
    kind: "quiz",
    startsAt: "2026-08-25T19:30:00.000Z",
    title: "Tuesday pub quiz",
    source: { label: "Question One", url: "https://questionone.com/venues/quiz-pub" },
    observedAt: "2026-08-24T10:00:00.000Z",
    confidence: "listed",
  };
}

function kindRow(kind: Exclude<WhatsOnRow["kind"], "event" | "quiz">): WhatsOnRow {
  return { ...quizRow(`${kind}-1`), kind, title: `${kind} listing` };
}

function memoryStore(): WhatsOnListingStore & { kinds: string[] } {
  const rows = new Map<string, WhatsOnRow[]>();
  return {
    kinds: [],
    async replaceKind(kind, next) {
      this.kinds.push(kind);
      rows.set(kind, next);
      return { written: next.length };
    },
    async readAll() {
      return { rows: [...rows.values()].flat(), generatedAt: GENERATED };
    },
    async readGeneratedAt() {
      return { generatedAt: GENERATED };
    },
  };
}

describe("refreshOfficialWhatsOnListings", () => {
  it("writes live event rows to the durable store", async () => {
    const store = memoryStore();
    let fetchContext: Parameters<NonNullable<OutLiveProvider["fetchTonight"]>>[0] | undefined;
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async (context) => {
          fetchContext = context;
          return [eventRow("tm-1")];
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: true, mode: "providers", written: 1 });
    expect(result.observedAt).toBeTruthy();
    expect(fetchContext?.cache).toBe("bypass");
    const snap = await store.readAll();
    expect(snap.rows.map((row) => row.id)).toEqual(["tm-1"]);
  });

  it("matches a canonical pub before the durable write", async () => {
    const store = memoryStore();
    const venueMatchIndex = buildOutVenueMatchIndex([LEXINGTON]);
    const row = {
      ...eventRow("tm-lexington"),
      placeName: LEXINGTON.name,
      lat: LEXINGTON.lat,
      lng: LEXINGTON.lng,
    };
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [row],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => venueMatchIndex,
    });

    expect(result.providers).toEqual([
      expect.objectContaining({
        name: "ticketmaster",
        fetched: 1,
        dateValid: 1,
        matchStatus: "ready",
        matched: 1,
        unmatched: 0,
      }),
    ]);

    const snap = await store.readAll();
    expect(snap.rows).toHaveLength(1);
    expect(defined(snap.rows[0]).venueId).toBe(LEXINGTON.id);

    const pubOnly = await loadWhatsOn(
      { pubOnly: true, venueMatchIndex },
      {
        now: NOW,
        loadBaseline: () => snap.rows,
        fetchLive: async () => [],
      },
    );
    expect(pubOnly.rows.map((stored) => stored.id)).toEqual(["tm-lexington"]);
  });

  it("keeps previous matched rows when the venue index is unavailable", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => null,
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({
        name: "ticketmaster",
        matchStatus: "unavailable",
        matched: 0,
        unmatched: 1,
      }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });

  it("keeps previous matched rows when loading the venue index throws", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => {
        throw new Error("venue index unavailable");
      },
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({
        name: "ticketmaster",
        matchStatus: "unavailable",
        matched: 0,
        unmatched: 1,
      }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });

  it("keeps previous matched rows when the venue index is empty", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => buildOutVenueMatchIndex([]),
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({ matchStatus: "unavailable", matched: 0, unmatched: 1 }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });

  it("keeps unmatched entertainment out of pub-only supply and reports the loss", async () => {
    const store = memoryStore();
    const venueMatchIndex = buildOutVenueMatchIndex([LEXINGTON]);
    const arena = {
      ...eventRow("tm-arena"),
      placeName: "The O2 Arena",
      lat: 51.503,
      lng: 0.0032,
    };
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [arena],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers,
      loadVenueMatchIndex: async () => venueMatchIndex,
    });

    expect(result.providers).toEqual([
      expect.objectContaining({
        fetched: 1,
        dateValid: 1,
        cityValid: 1,
        matchStatus: "ready",
        matched: 0,
        unmatched: 1,
      }),
    ]);
    const snap = await store.readAll();
    expect(snap.rows).toEqual([expect.objectContaining({ id: "tm-arena" })]);
    expect(snap.rows[0]).not.toHaveProperty("venueId");
    const pubOnly = await loadWhatsOn(
      { pubOnly: true, venueMatchIndex },
      { now: NOW, loadBaseline: () => snap.rows, fetchLive: async () => [] },
    );
    expect(pubOnly.rows).toEqual([]);
  });

  it("reports and drops provider rows outside Greater London", async () => {
    const store = memoryStore();
    const outsideLondon = {
      ...eventRow("tm-brighton"),
      placeName: "Brighton Dome",
      lat: 50.823,
      lng: -0.138,
    };
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [outsideLondon],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });

    expect(result.providers).toEqual([
      expect.objectContaining({ fetched: 1, dateValid: 1, cityValid: 0, rows: 0 }),
    ]);
    expect((await store.readAll()).rows).toEqual([]);
  });

  it("drops expired provider rows before they reach the store", async () => {
    const store = memoryStore();
    const expired = eventRow("old");
    expired.startsAt = "2026-08-22T19:00:00.000Z";
    expired.endsAt = "2026-08-22T22:00:00.000Z";
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [expired],
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.written).toBe(0);
    expect(result.providers).toEqual([
      expect.objectContaining({ fetched: 1, dateValid: 0, cityValid: 0, rows: 0 }),
    ]);
    expect((await store.readAll()).rows).toEqual([]);
  });

  it("keeps the previous store when every configured provider fails", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("kept")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => {
          throw new Error("Ticketmaster Discovery API returned 500");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.ok).toBe(false);
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("keeps the previous store when one configured provider fails", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("kept")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new")],
      },
      {
        name: "skiddle",
        isConfigured: () => true,
        fetchTonight: async () => {
          throw new Error("Skiddle unavailable");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["kept"]);
  });

  it("preserves rows from providers that are not configured", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("old-other", "Other Events")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new-ticketmaster")],
      },
      {
        name: "other-events",
        isConfigured: () => false,
        fetchTonight: async () => {
          throw new Error("must not fetch an unconfigured provider");
        },
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.ok).toBe(true);
    expect((await store.readAll()).rows.map((row) => row.id).sort()).toEqual([
      "new-ticketmaster",
      "old-other",
    ]);
  });

  it("does not preserve fenced Skiddle rows", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [eventRow("old-skiddle", "Skiddle")], GENERATED);
    const providers: OutLiveProvider[] = [
      {
        name: "ticketmaster",
        isConfigured: () => true,
        fetchTonight: async () => [eventRow("new-ticketmaster")],
      },
      {
        name: "skiddle",
        isConfigured: () => false,
        fetchTonight: async () => [],
      },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result.ok).toBe(true);
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["new-ticketmaster"]);
  });

  it("does not invent a refresh when no provider is configured", async () => {
    const store = memoryStore();
    const providers: OutLiveProvider[] = [
      { name: "ticketmaster", isConfigured: () => false, fetchTonight: async () => [eventRow("x")] },
    ];
    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });
    expect(result).toMatchObject({ ok: false, mode: "no-providers", written: 0, observedAt: null });
  });

  it("persists non-event feed rows under their own durable kind", async () => {
    const store = memoryStore();
    const providers: OutLiveProvider[] = [
      {
        name: "question one",
        isConfigured: () => true,
        fetchTonight: async () => [quizRow("quiz-1")],
      },
    ];

    const result = await refreshOfficialWhatsOnListings({ now: NOW, store, providers });

    expect(result).toMatchObject({ ok: true, written: 1 });
    expect(store.kinds).toEqual(["quiz"]);
    expect((await store.readAll()).rows).toEqual([quizRow("quiz-1")]);
  });

  it("reports rows committed before a later kind write fails", async () => {
    const store = memoryStore();
    const originalReplace = store.replaceKind.bind(store);
    store.replaceKind = async (kind, rows, generatedAt) => {
      if (kind === "quiz") throw new Error("quiz durable write failed");
      return originalReplace(kind, rows, generatedAt);
    };
    const result = await refreshOfficialWhatsOnListings({
      now: NOW,
      store,
      providers: [
        {
          name: "bounded-provider",
          isConfigured: () => true,
          fetchTonight: async () => [eventRow("event-1"), quizRow("quiz-1")],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      written: 1,
      observedAt: GENERATED,
    });
    expect((await store.readAll()).rows.map((row) => row.id)).toEqual(["event-1"]);
  });

  it("refreshes quiz, deal, music, and sport feeds into the durable store", async () => {
    const store = memoryStore();
    const result = await refreshWhatsOnListings({
      now: NOW,
      store,
      providers: [
        {
          name: "ticketmaster",
          isConfigured: () => true,
          fetchTonight: async () => [eventRow("event-1")],
        },
      ],
      refreshers: {
        quiz: async () => [quizRow("quiz-1")],
        deal: async () => [kindRow("deal")],
        music: async () => [kindRow("music")],
        sport: async () => [kindRow("sport")],
      },
    });

    expect(result.ok).toBe(true);
    expect(store.kinds.sort()).toEqual(["deal", "event", "music", "quiz", "sport"]);
    expect((await store.readAll()).rows.map((row) => row.kind).sort()).toEqual([
      "deal",
      "event",
      "music",
      "quiz",
      "sport",
    ]);
  });

  it("serves no deal rows from a table that reads no source", async () => {
    const store = memoryStore();
    await store.replaceKind("deal", [kindRow("deal")], GENERATED);
    const result = await refreshWhatsOnListings({
      now: Date.parse("2026-07-20T20:00:00.000Z"),
      store,
      providers: [],
      refreshers: {
        quiz: async () => [],
        music: async () => [],
        sport: async () => [],
      },
    });

    const deals = (await store.readAll()).rows.filter((row) => row.kind === "deal");
    expect(deals.map((row) => `${row.observedAt} ${row.detail ?? ""}`)).toEqual([]);
    expect(result.kinds).toContainEqual({ name: "deal", kind: "deal", rows: 0 });
  });

  it("keeps previous sport rows when the live fixture lane throws", async () => {
    const store = memoryStore();
    await store.replaceKind("sport", [kindRow("sport")], GENERATED);
    const result = await refreshWhatsOnListings({
      now: NOW,
      store,
      providers: [
        {
          name: "ticketmaster",
          isConfigured: () => false,
          fetchTonight: async () => [],
        },
      ],
      refreshers: {
        quiz: async () => [],
        deal: async () => [],
        music: async () => [],
        sport: async () => {
          throw new Error("sport fixtures unavailable");
        },
      },
    });

    expect(result.kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "sport", rows: 0, error: "sport fixtures unavailable" }),
      ]),
    );
    expect((await store.readAll()).rows).toEqual([expect.objectContaining({ kind: "sport" })]);
  });

    it("forwards venue-index failure through the full refresh", async () => {
    const store = memoryStore();
    await store.replaceKind("event", [{ ...eventRow("kept"), venueId: LEXINGTON.id }], GENERATED);

    const result = await refreshWhatsOnListings({
      now: NOW,
      store,
      providers: [
        {
          name: "ticketmaster",
          isConfigured: () => true,
          fetchTonight: async () => [eventRow("new")],
        },
      ],
      loadVenueMatchIndex: async () => null,
      refreshers: {
        quiz: async () => [],
        deal: async () => [],
        music: async () => [],
        sport: async () => [],
      },
    });

    expect(result).toMatchObject({ ok: false, written: 0, observedAt: null });
    expect(result.providers).toEqual([
      expect.objectContaining({ matchStatus: "unavailable", unmatched: 1 }),
    ]);
    expect((await store.readAll()).rows).toEqual([
      expect.objectContaining({ id: "kept", venueId: LEXINGTON.id }),
    ]);
  });
});

describe("live sport for a London reader", () => {
  it.each([
    { licensed: "ready", openFootball: "ready" },
    { licensed: "empty", openFootball: "ready" },
    { licensed: "failed", openFootball: "ready" },
    { licensed: "ready", openFootball: "empty" },
    { licensed: "ready", openFootball: "failed" },
  ])("stores each match once per pub with its source: %j", async ({ licensed, openFootball }) => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "test-key");
    vi.stubEnv("THESPORTSDB_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isOpenFootball = url.includes("api.github.com");
      const state = isOpenFootball ? openFootball : licensed;
      if (state === "failed") throw new Error("provider unavailable");
      if (url.includes("/commits?")) {
        return new Response(JSON.stringify([{ sha: "a".repeat(40), commit: { committer: { date: "2026-10-05T10:00:00Z" } } }]));
      }
      const matches = state === "empty" ? [] : isOpenFootball
        ? [
          { date: "2026-10-09", time: "20:00", team1: "Arsenal", team2: "Chelsea" },
          { date: "2026-10-09", time: "20:00", team1: "Bournemouth", team2: "Brentford" },
          { date: "2026-10-09", time: "20:00", team1: "Chelsea", team2: "Arsenal" },
          { date: "2026-10-09", time: "21:00", team1: "Everton", team2: "Fulham" },
          { date: "2026-10-10", time: "20:00", team1: "Arsenal", team2: "Chelsea" },
        ]
        : url.includes("/PL/") || url.includes("/CL/") ? [{
          id: url.includes("/PL/") ? 1 : 2,
          utcDate: "2026-10-09T19:00:00Z",
          status: "SCHEDULED",
          homeTeam: { name: "Arsenal FC" },
          awayTeam: { name: "Chelsea FC" },
          competition: { name: url.includes("/PL/") ? "Premier League" : "Champions League" },
        }] : [];
      return new Response(JSON.stringify({ matches }));
    }));
    try {
      const store = memoryStore();
      const result = await refreshWhatsOnListings({
        now, store, providers: [],
        refreshers: { quiz: async () => [], deal: async () => [], music: async () => [] },
      });
      expect(result.kinds.find((kind) => kind.kind === "sport")?.error).toBeUndefined();
      const { rows } = await store.readAll();
      expect(rows.length).toBeGreaterThan(0);
      const pubs = new Set(rows.map((row) => row.source.url));
      for (const pub of pubs) {
        const pubRows = rows.filter((row) => row.source.url === pub);
        expect(pubRows).toHaveLength(openFootball === "ready" ? (licensed === "ready" ? 6 : 5) : 2);
        const arsenal = pubRows.filter((row) => row.title.startsWith("Arsenal") && row.title.endsWith("Premier League") && Date.parse(row.startsAt ?? "") === Date.parse("2026-10-09T19:00:00Z"));
        expect(arsenal).toHaveLength(1);
        expect(defined(arsenal[0]).detail).toContain(
          licensed === "ready" ? "Fixture per football-data.org" : "Fixture per OpenFootball",
        );
        if (openFootball === "ready") {
          expect(pubRows.find((row) => row.title.includes("Bournemouth"))?.detail).toContain("Fixture per OpenFootball");
        }
      }
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it.each<{
    licensedFailure: "all" | "PL" | "none";
    openFootballFails: boolean;
    footballKickoff?: string;
    rugbyKickoff?: string;
  }>([
    { licensedFailure: "all", openFootballFails: false },
    { licensedFailure: "none", openFootballFails: true },
    { licensedFailure: "all", openFootballFails: true },
    { licensedFailure: "none", openFootballFails: false },
    { licensedFailure: "PL", openFootballFails: false },
    { licensedFailure: "PL", openFootballFails: false, footballKickoff: "2026-08-24T17:00:00Z" },
    { licensedFailure: "PL", openFootballFails: false, footballKickoff: "2026-09-04T19:00:00Z" },
    { licensedFailure: "PL", openFootballFails: false, footballKickoff: "2026-08-29T14:00:00Z" },
    { licensedFailure: "all", openFootballFails: false, rugbyKickoff: "2026-08-25T19:00:00Z" },
    { licensedFailure: "PL", openFootballFails: false, rugbyKickoff: "2026-08-25T19:00:00Z" },
    { licensedFailure: "none", openFootballFails: false, rugbyKickoff: "2026-08-25T19:00:00Z" },
    { licensedFailure: "all", openFootballFails: false, rugbyKickoff: "2026-08-24T17:00:00Z" },
    { licensedFailure: "all", openFootballFails: false, rugbyKickoff: "2026-09-04T19:00:00Z" },
  ])("preserves stored sport on an empty refresh with a failed loader: %j", async ({ licensedFailure, openFootballFails, footballKickoff, rugbyKickoff }) => {
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "test-key");
    vi.stubEnv("THESPORTSDB_API_KEY", rugbyKickoff ? "paid-test-key" : "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        if (openFootballFails) throw new Error("provider unavailable");
        return new Response(JSON.stringify([
          { sha: "a".repeat(40), commit: { committer: { date: "2026-08-01T10:00:00Z" } } },
        ]));
      }
      if (url.includes("football-data.org")) {
        if (licensedFailure === "all" || (licensedFailure === "PL" && url.includes("/PL/"))) {
          throw new Error("provider unavailable");
        }
        return new Response(JSON.stringify({ matches: footballKickoff ? [{
          id: 1,
          utcDate: footballKickoff,
          status: "SCHEDULED",
          homeTeam: { name: "Arsenal" },
          awayTeam: { name: "Chelsea" },
        }] : [] }));
      }
      return new Response(JSON.stringify({ events: rugbyKickoff ? [{
        idEvent: "rugby-1",
        strHomeTeam: "Harlequins",
        strAwayTeam: "Bath",
        strTimestamp: rugbyKickoff,
        strStatus: "NS",
      }] : [] }));
    }));
    try {
      const store = memoryStore();
      const previous = kindRow("sport");
      await store.replaceKind("sport", [previous], GENERATED);
      const result = await refreshWhatsOnListings({
        now: NOW,
        store,
        providers: [],
        refreshers: { quiz: async () => [], deal: async () => [], music: async () => [] },
      });
      const report = result.kinds.find((kind) => kind.kind === "sport");
      if (licensedFailure !== "none" || openFootballFails) {
        expect(report?.error).toBe("Sport fixtures unavailable");
        expect((await store.readAll()).rows).toEqual([previous]);
      } else {
        expect(report?.error).toBeUndefined();
        expect((await store.readAll()).rows).toEqual([]);
      }
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("serves tonight's live fixture at London sport pubs on the default read", async () => {
    const now = Date.parse("2026-10-07T12:00:00.000Z");
    vi.stubEnv("FOOTBALL_DATA_API_KEY", "test-key");
    vi.stubEnv("THESPORTSDB_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.github.com")) {
          return new Response(JSON.stringify([
            { sha: "a".repeat(40), commit: { committer: { date: "2026-09-01T10:00:00Z" } } },
          ]));
        }
        const matches = url.includes("/PL/") ? [{
          id: 9200001,
          homeTeam: { name: "Arsenal" },
          awayTeam: { name: "Chelsea" },
          utcDate: "2026-10-07T19:00:00Z",
          status: "SCHEDULED",
          competition: { name: "Premier League" },
        }] : [];
        return new Response(JSON.stringify({ matches }));
      }),
    );
    try {
      const store = memoryStore();
      const result = await refreshWhatsOnListings({
        now,
        store,
        providers: [],
        refreshers: {
          quiz: async () => [],
          deal: async () => [],
          music: async () => [],
        },
      });
      expect(result.kinds.find((report) => report.kind === "sport")).toMatchObject({
        rows: expect.any(Number),
      });
      expect(result.kinds.find((report) => report.kind === "sport")?.error).toBeUndefined();

      const snap = await store.readAll();
      const london = await loadWhatsOn(
        { kind: "sport", window: "tonight" },
        { now, loadBaseline: () => snap.rows, fetchLive: async () => [] },
      );
      expect(london.rows.length).toBeGreaterThan(0);
      for (const row of london.rows) {
        expect(row.kind).toBe("sport");
        expect(row.title).toContain("Arsenal v Chelsea");
        expect(row.detail).toContain("Fixture per football-data.org");
        expect(Date.parse(row.startsAt ?? "")).toBe(Date.parse("2026-10-07T19:00:00Z"));
        expect(row.lat).toBeGreaterThan(51.28);
        expect(row.lat).toBeLessThan(51.7);
      }
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
