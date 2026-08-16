import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { DATE_ONLY_TIME_EVIDENCE } from "@/lib/whatson/eventNormalise.mjs";
import {
  EVENT_REFRESH_CITIES,
  SKIDDLE_EVENTCODE_KIND,
  TICKETMASTER_SEGMENT_KIND,
  dedupeEventRowsBySourceId,
  mapSkiddleEvent,
  mapTicketmasterEvent,
  normaliseSkiddleEvents,
  normaliseTicketmasterEvents,
  providerLaneStatus,
  runEventsRefresh,
  summariseEventDrops,
} from "../scripts/whatson/eventsRefresh.mjs";
import { commandsForMode } from "../scripts/local-refresh/scheduler.mjs";
import { isValidWhatsOnRow } from "@/lib/whatsOn";

const temporaryDirs: string[] = [];
afterAll(() => {
  for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

const observedAt = "2026-08-16T09:00:00.000Z";
const now = Date.parse(observedAt);

const tmTheatre = {
  id: "tm-theatre-1",
  name: "A Night at the Playhouse",
  url: "https://www.ticketmaster.co.uk/event/tm-theatre-1",
  dates: { start: { dateTime: "2026-08-16T19:00:00Z" } },
  classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Theatre" } }],
  images: [{ url: "https://img.ticketmaster.com/theatre.jpg" }],
  priceRanges: [{ currency: "GBP", min: 28 }],
  _embedded: {
    venues: [
      {
        name: "Soho Theatre",
        location: { latitude: "51.5145", longitude: "-0.132" },
      },
    ],
  },
};

const tmComedy = {
  id: "tm-comedy-1",
  name: "Late Stand-up",
  url: "https://www.ticketmaster.co.uk/event/tm-comedy-1",
  dates: { start: { dateTime: "2026-08-16T20:30:00Z" } },
  classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Comedy" } }],
  _embedded: { venues: [{ name: "The Comedy Store" }] },
};

const tmMusic = {
  id: "tm-music-1",
  name: "Indie Night Live",
  url: "https://www.ticketmaster.co.uk/event/tm-music-1",
  dates: { start: { dateTime: "2026-08-16T20:00:00Z" } },
  classifications: [{ segment: { name: "Music" } }],
  _embedded: { venues: [{ name: "The Dublin Castle" }] },
};

const tmFilmDropped = {
  id: "tm-film-1",
  name: "A Screening",
  url: "https://www.ticketmaster.co.uk/event/tm-film-1",
  dates: { start: { dateTime: "2026-08-16T18:00:00Z" } },
  classifications: [{ segment: { name: "Film" } }],
  _embedded: { venues: [{ name: "A Cinema" }] },
};

describe("Ticketmaster / Skiddle kind mapping", () => {
  it("maps theatre and comedy onto kind event instead of dropping them", () => {
    expect(TICKETMASTER_SEGMENT_KIND["Arts & Theatre"]).toBe("event");
    const theatre = mapTicketmasterEvent(tmTheatre, { observedAt });
    const comedy = mapTicketmasterEvent(tmComedy, { observedAt });
    expect(theatre).toMatchObject({
      kind: "event",
      sourceId: "tm-theatre-1",
      imageUrl: "https://img.ticketmaster.com/theatre.jpg",
      priceGbp: 28,
      source: { label: "Ticketmaster", url: tmTheatre.url },
    });
    expect(comedy?.kind).toBe("event");
    expect(isValidWhatsOnRow(theatre as unknown, now)).toBe(true);
    expect(isValidWhatsOnRow(comedy as unknown, now)).toBe(true);
  });

  it("maps Skiddle club, comedy, theatre and BARPUB onto kind event", () => {
    expect(SKIDDLE_EVENTCODE_KIND.CLUB).toBe("event");
    expect(SKIDDLE_EVENTCODE_KIND.COMEDY).toBe("event");
    expect(SKIDDLE_EVENTCODE_KIND.THEATRE).toBe("event");
    expect(SKIDDLE_EVENTCODE_KIND.BARPUB).toBe("event");
    const club = mapSkiddleEvent(
      {
        id: 901,
        eventname: "Warehouse Night",
        EventCode: "CLUB",
        link: "https://www.skiddle.com/whats-on/e/901",
        startdate: "2026-08-16 22:00:00",
        venue: { name: "A Basement" },
      },
      { observedAt },
    );
    expect(club).toMatchObject({
      kind: "event",
      sourceId: "901",
      source: { label: "Skiddle", url: "https://www.skiddle.com/whats-on/e/901" },
    });
    expect(isValidWhatsOnRow(club as unknown, now)).toBe(true);
  });

  it("carries a Skiddle bare date as a DATE, never an invented 20:00 start", () => {
    const bareDate = mapSkiddleEvent(
      {
        id: 902,
        eventname: "Sunday session",
        EventCode: "BARPUB",
        link: "https://www.skiddle.com/whats-on/e/902",
        date: "2026-08-16",
        enddate: "2026-08-16 23:00:00",
        venue: { name: "The Dublin Castle" },
      },
      { observedAt },
    );
    expect(bareDate?.startsAt).toBeUndefined();
    expect(bareDate?.startsDate).toBe("2026-08-16");
    expect(bareDate?.timeEvidence).toBe(DATE_ONLY_TIME_EVIDENCE);
    // An endsAt without an exact start is not an interval, so it is dropped
    // rather than pairing a real close with a start nobody published.
    expect(bareDate?.endsAt).toBeUndefined();
    expect(JSON.stringify(bareDate)).not.toContain("20:00");
    expect(isValidWhatsOnRow(bareDate as unknown, now)).toBe(true);
  });

  it("keeps the exact clock when Skiddle really states one", () => {
    const timed = mapSkiddleEvent(
      {
        id: 903,
        eventname: "Doors at eight",
        EventCode: "CLUB",
        link: "https://www.skiddle.com/whats-on/e/903",
        date: "2026-08-16",
        openingtimes: { doorsopen: "2026-08-16 20:00:00" },
        venue: { name: "A Basement" },
      },
      { observedAt },
    );
    expect(timed?.startsDate).toBeUndefined();
    expect(timed?.timeEvidence).toBeUndefined();
    expect(timed?.startsAt).toBe("2026-08-16T19:00:00.000Z");
  });

  it("still maps Music to music and LIVE to music", () => {
    expect(mapTicketmasterEvent(tmMusic, { observedAt })?.kind).toBe("music");
    expect(
      mapSkiddleEvent(
        {
          id: 900,
          eventname: "Blues Jam",
          EventCode: "LIVE",
          link: "https://www.skiddle.com/whats-on/e/900",
          startdate: "2026-08-16 20:30:00",
          venue: { name: "The Dublin Castle" },
        },
        { observedAt },
      )?.kind,
    ).toBe("music");
  });
});

describe("dropped-row counts", () => {
  it("counts dropped Film / missing-field rows instead of staying silent", () => {
    const { rows, dropped } = normaliseTicketmasterEvents(
      { _embedded: { events: [tmMusic, tmTheatre, tmFilmDropped, { id: "bare" }] } },
      { observedAt },
    );
    expect(rows.map((row) => row.sourceId)).toEqual(["tm-music-1", "tm-theatre-1"]);
    expect(dropped.total).toBe(2);
    expect(dropped.noKind + dropped.noPlace + dropped.noStart + dropped.noUrl + dropped.noTitle).toBe(
      dropped.total,
    );
    expect(summariseEventDrops(dropped)).toMatch(/dropped 2/);
  });

  it("counts a Skiddle DATE drop", () => {
    const { rows, dropped } = normaliseSkiddleEvents(
      {
        results: [
          {
            id: 7,
            eventname: "Speed dating",
            EventCode: "DATE",
            link: "https://www.skiddle.com/whats-on/e/7",
            startdate: "2026-08-16 19:00:00",
            venue: { name: "A Bar" },
          },
        ],
      },
      { observedAt },
    );
    expect(rows).toEqual([]);
    expect(dropped.noKind).toBe(1);
    expect(summariseEventDrops(dropped)).toMatch(/noKind=1/);
  });
});

describe("sourceId dedupe", () => {
  it("keeps one row per provider sourceId", () => {
    const first = mapTicketmasterEvent(tmTheatre, { observedAt })!;
    const second = mapTicketmasterEvent(
      { ...tmTheatre, name: "A Night at the Playhouse (late)" },
      { observedAt },
    )!;
    const deduped = dedupeEventRowsBySourceId([first, second]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sourceId).toBe("tm-theatre-1");
  });
});

describe("keyless lanes", () => {
  it("names Skiddle not-configured when the key is absent, never an empty market", () => {
    const lanes = providerLaneStatus({ TICKETMASTER_API_KEY: "tm-present" });
    expect(lanes.ticketmaster).toBe("configured");
    expect(lanes.skiddle).toBe("not-configured");
    expect(lanes.skiddle).not.toBe("empty");
  });

  it("names both lanes not-configured with no keys", () => {
    const lanes = providerLaneStatus({});
    expect(lanes.ticketmaster).toBe("not-configured");
    expect(lanes.skiddle).toBe("not-configured");
  });
});

describe("city readiness", () => {
  it("is ready for London plus the map cities the brief names", () => {
    expect(EVENT_REFRESH_CITIES).toEqual([
      "london",
      "bristol",
      "cambridge",
      "glasgow",
      "liverpool",
      "manchester",
      "oxford",
    ]);
  });
});

describe("local scheduler events mode", () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    vi.restoreAllMocks();
  });

  it("runs the official refresh then the Common reader, as INDEPENDENT lanes", () => {
    const commands = commandsForMode("events", false);
    expect(commands.map((command) => command.args)).toEqual([
      ["scripts/whatson/eventsRefresh.mjs"],
      ["scripts/whatson/commonRefresh.mjs"],
    ]);
    // eventsRefresh exits non-zero on ordinary outcomes (an upstream 5xx, or
    // its deliberate "0 mappable rows, refusing to clobber" refusal). Common
    // depends on Ticketmaster for nothing, so it must still run.
    expect(commands.every((command) => command.independent === true)).toBe(true);
    // And the Common lane declares no key requirement, so a keyless machine
    // still runs it.
    expect(commands[1].requiresAnyKey).toBeUndefined();
  });
});

describe("runEventsRefresh end to end", () => {
  const NOW_MS = Date.parse("2026-08-16T09:00:00.000Z");

  function temporaryOutPath() {
    const dir = mkdtempSync(join(tmpdir(), "events-refresh-"));
    temporaryDirs.push(dir);
    return join(dir, "events_london.json");
  }

  function ticketmasterResponse() {
    return new Response(JSON.stringify({ _embedded: { events: [tmTheatre] } }), { status: 200 });
  }

  it("writes the file with both source descriptors on a keyed run", async () => {
    const outPath = temporaryOutPath();
    const commonCalls: unknown[] = [];
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () => ticketmasterResponse()) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async (options) => {
        commonCalls.push(options);
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.provider.status).toBe("wrote");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    // payload.sources is where the two source constants are read. A binding
    // that only re-exported them made this line a ReferenceError, and nothing
    // was ever written.
    expect(written.sources.map((source: { label: string }) => source.label)).toEqual([
      "Ticketmaster",
      "Skiddle",
    ]);
    expect(written.generatedAt).toBe(new Date(NOW_MS).toISOString());
    expect(written.rows).toHaveLength(1);
    expect(commonCalls).toHaveLength(1);
  });

  it("runs the keyless Common lane even when the Ticketmaster lane fails", async () => {
    const outPath = temporaryOutPath();
    let commonRan = false;
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () => new Response("upstream down", { status: 503 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        commonRan = true;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("failed");
    expect(commonRan).toBe(true);
    expect(result.common.status).toBe("ran");
    // The exit code stays honest about the lane that failed.
    expect(result.ok).toBe(false);
  });

  it("runs the Common lane through the zero-rows no-clobber refusal", async () => {
    const outPath = temporaryOutPath();
    let commonRan = false;
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ _embedded: { events: [] } }), { status: 200 })) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        commonRan = true;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(result.provider.status).toBe("refused");
    expect(existsSync(outPath)).toBe(false);
    expect(commonRan).toBe(true);
  });

  it("runs the Common lane with no provider key at all, spending no upstream call", async () => {
    const outPath = temporaryOutPath();
    let fetched = 0;
    let commonRan = false;
    const result = await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: {},
      nowMs: NOW_MS,
      fetchImpl: (async () => {
        fetched += 1;
        return ticketmasterResponse();
      }) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => {
        commonRan = true;
        return { rows: [] };
      },
      log: () => {},
      logError: () => {},
    });

    expect(fetched).toBe(0);
    expect(result.provider.status).toBe("not-configured");
    expect(commonRan).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("resolves a venueId only when the CLI injects a venue index", async () => {
    const outPath = temporaryOutPath();
    await runEventsRefresh({
      argv: ["node", "eventsRefresh.mjs"],
      env: { TICKETMASTER_API_KEY: "test-key" },
      nowMs: NOW_MS,
      fetchImpl: (async () => ticketmasterResponse()) as unknown as typeof fetch,
      outPath,
      loadVenueIndex: () => null,
      runCommonLane: async () => ({ rows: [] }),
      log: () => {},
      logError: () => {},
    });
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.rows[0].venueId).toBeUndefined();
    expect(written.rows[0].placeName).toEqual(expect.any(String));
  });
});
