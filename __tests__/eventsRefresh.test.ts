import { afterEach, describe, expect, it, vi } from "vitest";

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
  summariseEventDrops,
} from "../scripts/whatson/eventsRefresh.mjs";
import { commandsForMode } from "../scripts/local-refresh/scheduler.mjs";
import { isValidWhatsOnRow } from "@/lib/whatsOn";

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

  it("runs the official refresh then the Common reader", () => {
    expect(commandsForMode("events", false).map((command) => command.args)).toEqual([
      ["scripts/whatson/eventsRefresh.mjs"],
      ["scripts/whatson/commonRefresh.mjs"],
    ]);
  });
});
