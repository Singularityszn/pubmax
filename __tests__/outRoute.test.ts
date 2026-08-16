import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/out/route";
import {
  MAX_OUT_EVENTS,
  buildOutResponse,
  isOutCityCovered,
  outDayWindow,
  parseOutQuery,
} from "@/lib/out/loadOut";
import { outAnswerView, outStatusLines } from "@/lib/out/outStatus";
import { londonServiceDayBounds } from "@/lib/whatsOn";
import type { OutResponse } from "@/lib/out/types";
import type { WhatsOnRow } from "@/lib/whatsOn";

const FIXTURE_NOW = new Date("2026-08-16T17:00:00.000Z");
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_TM = process.env.TICKETMASTER_API_KEY;
const ORIGINAL_SK = process.env.SKIDDLE_API_KEY;

function eventRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "events-tm-1",
    placeName: "Soho Theatre",
    kind: "event",
    startsAt: "2026-08-16T19:00:00.000Z",
    title: "A Night at the Playhouse",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    sourceId: "1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXTURE_NOW);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.TICKETMASTER_API_KEY;
  delete process.env.SKIDDLE_API_KEY;
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  }
  if (ORIGINAL_TM === undefined) delete process.env.TICKETMASTER_API_KEY;
  else process.env.TICKETMASTER_API_KEY = ORIGINAL_TM;
  if (ORIGINAL_SK === undefined) delete process.env.SKIDDLE_API_KEY;
  else process.env.SKIDDLE_API_KEY = ORIGINAL_SK;
});

describe("parseOutQuery", () => {
  it("defaults to london / today and accepts the closed day set", () => {
    expect(parseOutQuery(new URLSearchParams())).toEqual({ city: "london", day: "today" });
    expect(parseOutQuery(new URLSearchParams("city=london&day=tomorrow"))).toEqual({
      city: "london",
      day: "tomorrow",
    });
    expect(parseOutQuery(new URLSearchParams("day=weekend"))?.day).toBe("weekend");
  });

  it("rejects an unknown day or city", () => {
    expect(parseOutQuery(new URLSearchParams("day=next-month"))).toBeNull();
    expect(parseOutQuery(new URLSearchParams("city=paris"))).toBeNull();
  });
});

describe("buildOutResponse", () => {
  const noLiveLane = () => [
    { name: "ticketmaster", isConfigured: () => false, fetchTonight: async () => [] },
    { name: "skiddle", isConfigured: () => false, fetchTonight: async () => [] },
  ];

  it("says the listings are off when no lane was asked AND nothing is on screen", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [], liveProviders: noLiveLane() },
    );
    // A missing key is not-configured, never an empty-market claim.
    expect(body.status).toBe("not-configured");
    expect(body.events).toEqual([]);
    expect(body.openPlans).toEqual([]);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "skiddle", configured: false, rows: 0 }),
      ]),
    );
    expect(outStatusLines({ body, failed: false })).toEqual([
      "Listings are not switched on yet.",
    ]);
  });

  it("stays ready over bundled rows, so no line contradicts the cards on screen", async () => {
    // The keyless Common lane alone fills the bundled file. Those listings ARE
    // on, so saying otherwise above them would contradict what a reader sees.
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [eventRow()], liveProviders: noLiveLane() },
    );
    expect(body.status).toBe("ready");
    expect(body.events).toHaveLength(1);
    expect(outStatusLines({ body, failed: false })).toEqual([]);
  });

  it("keeps ready when a lane really was asked and answered", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow()],
        liveProviders: [
          { name: "ticketmaster", isConfigured: () => true, fetchTonight: async () => [] },
          { name: "skiddle", isConfigured: () => false, fetchTonight: async () => [] },
        ],
      },
    );
    expect(body.status).toBe("ready");
  });

  it("keeps degraded ahead of not-configured when one lane failed", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => {
          throw new Error("events file unreadable");
        },
        liveProviders: [
          { name: "skiddle", isConfigured: () => false, fetchTonight: async () => [] },
        ],
      },
    );
    expect(body.status).toBe("degraded");
    expect(outStatusLines({ body, failed: false })).toEqual([
      "Some listings could not be checked.",
    ]);
  });

  it("is degraded when a configured provider fails, and still returns bundled rows", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow()],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async () => {
              throw new Error("Ticketmaster Discovery API returned 503");
            },
          },
        ],
      },
    );
    expect(body.status).toBe("degraded");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].title).toBe("A Night at the Playhouse");
    // The public body says the lane is degraded and nothing about the upstream.
    expect(body.providers[0]).toEqual({
      name: "ticketmaster",
      configured: true,
      rows: 0,
      status: "degraded",
    });
    expect(JSON.stringify(body)).not.toContain("503");
  });

  it("answers an uncovered city with an honest reason and never another city's rows", async () => {
    const body = await buildOutResponse(
      { city: "bristol", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow()],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async () => [eventRow({ id: "live-1", sourceId: "live-1" })],
          },
        ],
      },
    );
    expect(body.status).toBe("degraded");
    expect(body.events).toEqual([]);
    expect(body.reason).toBe("Out does not cover Bristol yet.");
    expect(isOutCityCovered("london")).toBe(true);
    expect(isOutCityCovered("bristol")).toBe(false);
  });

  it("asks a live provider for the window it will keep, and the city it was asked about", async () => {
    const asked: { city?: string; window?: { startMs: number; endMs: number } }[] = [];
    await buildOutResponse(
      { city: "london", day: "tomorrow" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => true,
            fetchTonight: async (ctx) => {
              asked.push({ city: ctx.city, window: ctx.window });
              return [];
            },
          },
        ],
      },
    );
    const tomorrow = outDayWindow("tomorrow", FIXTURE_NOW.getTime());
    expect(asked).toEqual([{ city: "london", window: tomorrow }]);
  });

  it("closes the weekend at Sunday's own service end, not at Monday daytime", () => {
    // Friday 20:00 London.
    const friday = Date.parse("2026-08-14T19:00:00.000Z");
    const weekend = outDayWindow("weekend", friday);
    const sundayEvening = Date.parse("2026-08-16T20:00:00.000Z");
    const mondayMatinee = Date.parse("2026-08-17T13:00:00.000Z"); // Mon 14:00 BST
    expect(sundayEvening).toBeLessThan(weekend.endMs);
    // Sunday's evening closes at Monday 04:00; a Monday matinee is not a
    // weekend night and must fall outside the chip's window.
    expect(mondayMatinee).toBeGreaterThanOrEqual(weekend.endMs);
    expect(weekend.endMs).toBe(Date.parse(londonServiceDayBounds(sundayEvening).end));
  });

  it("keeps the weekend span honest across a BST/GMT transition", () => {
    // The clocks go back on Sunday 25 October 2026, inside this span.
    const friday = Date.parse("2026-10-23T19:00:00.000Z");
    const weekend = outDayWindow("weekend", friday);
    const sundayEvening = Date.parse("2026-10-25T20:00:00.000Z");
    expect(sundayEvening).toBeGreaterThanOrEqual(weekend.startMs);
    expect(sundayEvening).toBeLessThan(weekend.endMs);
    expect(weekend.endMs).toBe(Date.parse(londonServiceDayBounds(sundayEvening).end));
    // A raw three-day span would be an hour short of the real service window.
    expect(weekend.endMs - weekend.startMs).toBeGreaterThan(3 * 24 * 60 * 60 * 1000 - 12 * 60 * 60 * 1000);
  });

  it("keeps Sunday night inside the weekend window in the small hours", () => {
    // Sunday 02:00 London still belongs to SATURDAY's service evening. Reading
    // the weekday off `now` instead put Friday a day early and cut Sunday out.
    const sundaySmallHours = Date.parse("2026-08-16T01:00:00.000Z"); // Sun 02:00 BST
    const weekend = outDayWindow("weekend", sundaySmallHours);
    const sundayEvening = Date.parse("2026-08-16T20:00:00.000Z");
    expect(sundayEvening).toBeGreaterThanOrEqual(weekend.startMs);
    expect(sundayEvening).toBeLessThan(weekend.endMs);
  });

  it("windows a date-only row against its own stated evening", async () => {
    const dateOnly: WhatsOnRow = {
      id: "events-cm-1",
      placeName: "Camberwell",
      kind: "event",
      startsDate: "2026-08-16",
      timeEvidence: "Date listed, start time not published",
      title: "Sunday roast club",
      source: { label: "common", url: "https://www.common-social.com/post/abc" },
      observedAt: "2026-08-16T09:00:00.000Z",
      confidence: "listed",
    };
    const today = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [dateOnly], liveProviders: [] },
    );
    expect(today.events.map((row) => row.id)).toEqual(["events-cm-1"]);
    expect(today.events[0].startsAt).toBeUndefined();

    const tomorrow = await buildOutResponse(
      { city: "london", day: "tomorrow" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => [dateOnly], liveProviders: [] },
    );
    expect(tomorrow.events).toEqual([]);
  });

  it("never treats a failed baseline read as an empty market", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => {
          throw new Error("events file unreadable");
        },
        liveProviders: [],
      },
    );
    expect(body.status).toBe("degraded");
    expect(body.events).toEqual([]);
    expect(body.openPlans).toEqual([]);
  });

  it("caps events at 100 and sorts by startsAt", async () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      eventRow({
        id: `e-${index}`,
        sourceId: String(index),
        startsAt: new Date(Date.parse("2026-08-16T12:00:00.000Z") + (120 - index) * 60_000).toISOString(),
        title: `Row ${index}`,
      }),
    );
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      { now: FIXTURE_NOW.getTime(), loadBaseline: () => rows, liveProviders: [] },
    );
    expect(body.events).toHaveLength(MAX_OUT_EVENTS);
    const starts = body.events.map((row) => row.startsAt ?? "");
    expect(starts).toEqual([...starts].sort());
  });

  it("keeps venueId on a venue-matched row so a later lane can attach price and occupancy", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow({ venueId: "venue-soho-theatre" })],
        liveProviders: [],
      },
    );
    expect(body.events[0].venueId).toBe("venue-soho-theatre");
  });
});

describe("the two lanes fold onto one listing", () => {
  it("shows a Ticketmaster event once, keeping the bundled row's venue match", async () => {
    const bundled = eventRow({
      id: "events-tm-bundled",
      venueId: "venue-soho-theatre",
      sourceId: "tm-1",
      observedAt: "2026-08-16T06:00:00.000Z",
    });
    // Same listing off the live seam: no venue index, so no venueId, and the
    // place name alone gives dedupeRows a different key.
    const live = eventRow({
      id: "events-tm-live",
      sourceId: "tm-1",
      observedAt: "2026-08-16T16:00:00.000Z",
    });
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [bundled],
        liveProviders: [
          { name: "ticketmaster", isConfigured: () => true, fetchTonight: async () => [live] },
        ],
      },
    );
    expect(body.events).toHaveLength(1);
    expect(body.events[0].observedAt).toBe("2026-08-16T16:00:00.000Z");
    expect(body.events[0].venueId).toBe("venue-soho-theatre");
  });

  it("leaves two genuinely different listings alone", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [
          eventRow({ id: "a", sourceId: "tm-1" }),
          eventRow({ id: "b", sourceId: "tm-2", placeName: "Another Room" }),
        ],
        liveProviders: [],
      },
    );
    expect(body.events).toHaveLength(2);
  });
});

describe("GET /api/out", () => {
  it("sets the edge cache header on a 200", async () => {
    const res = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=900",
    );
    const body = await res.json();
    expect(["ready", "degraded", "not-configured"]).toContain(body.status);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.openPlans).toEqual([]);
  });

  it("uses the house error envelope for a bad day", async () => {
    const res = await GET(new Request("http://localhost/api/out?day=never"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toEqual(expect.any(String));
    expect(body.code).toEqual(expect.any(String));
    expect(typeof body.retryable).toBe("boolean");
  });
});

describe("outStatusLines", () => {
  it("never words a degraded answer as an empty market", () => {
    expect(
      outStatusLines({
        body: { status: "degraded", events: [], reason: "Out does not cover Bristol yet." },
        failed: false,
      }),
    ).toEqual(["Out does not cover Bristol yet."]);
    expect(outStatusLines({ body: { status: "degraded", events: [] }, failed: false })).toEqual([
      "Some listings could not be checked.",
    ]);
  });

  it("says it is checking while the pressed day has no answer yet", () => {
    // Never day chips over a blank area, and never worded as an empty market.
    expect(outStatusLines({ body: null, failed: false, pending: true })).toEqual([
      "Checking listings...",
    ]);
    // A failed read owns the line instead; pending never doubles it up.
    expect(outStatusLines({ body: null, failed: true, pending: true })).toEqual([
      "Could not check listings.",
    ]);
    // Once an answer lands the pending line is gone.
    expect(
      outStatusLines({ body: { status: "ready", events: [] }, failed: false, pending: false }),
    ).toEqual(["No listings for this day yet."]);
  });

  it("says the city is quiet only when the read actually answered", () => {
    expect(outStatusLines({ body: { status: "ready", events: [] }, failed: false })).toEqual([
      "No listings for this day yet.",
    ]);
    expect(outStatusLines({ body: null, failed: true })).toEqual(["Could not check listings."]);
    expect(
      outStatusLines({ body: { status: "ready", events: [eventRow()] }, failed: false }),
    ).toEqual([]);
  });
});

describe("outAnswerView", () => {
  const heldBody: Pick<OutResponse, "status" | "events" | "reason"> = {
    status: "ready",
    events: [],
  };
  const answer = { day: "today" as const, body: heldBody, failed: false };

  it("is pending before the FIRST answer lands, not only on a day switch", () => {
    // A reader opening /out meets the heading and the chips; nothing has
    // answered yet, so the surface says so rather than showing a blank area.
    const view = outAnswerView<Pick<OutResponse, "status" | "events" | "reason">>(null, "today");
    expect(view).toEqual({ body: null, failed: false, pending: true });
    expect(outStatusLines({ ...view })).toEqual(["Checking listings..."]);
  });

  it("is pending again the moment another day is pressed, holding no stale cards", () => {
    const view = outAnswerView(answer, "weekend");
    expect(view.body).toBeNull();
    expect(view.pending).toBe(true);
  });

  it("hands back the held answer once it is about the day on screen", () => {
    const view = outAnswerView(answer, "today");
    expect(view).toEqual({ body: answer.body, failed: false, pending: false });
    expect(outStatusLines({ ...view })).toEqual(["No listings for this day yet."]);
  });

  it("carries a failed read for its own day, and never as another day's", () => {
    const held = { day: "tomorrow" as const, body: null, failed: true };
    expect(outAnswerView(held, "tomorrow")).toEqual({ body: null, failed: true, pending: false });
    expect(outAnswerView(held, "today")).toEqual({ body: null, failed: false, pending: true });
  });
});
