import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/out/route";
import {
  MAX_OUT_EVENTS,
  buildOutResponse,
  parseOutQuery,
} from "@/lib/out/loadOut";
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
  it("stays ready with bundled rows when a live lane is not configured", async () => {
    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: FIXTURE_NOW.getTime(),
        loadBaseline: () => [eventRow()],
        liveProviders: [
          {
            name: "ticketmaster",
            isConfigured: () => false,
            fetchTonight: async () => [],
          },
          {
            name: "skiddle",
            isConfigured: () => false,
            fetchTonight: async () => [],
          },
        ],
      },
    );
    expect(body.status).toBe("ready");
    expect(body.events).toHaveLength(1);
    expect(body.openPlans).toEqual([]);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "skiddle", configured: false, rows: 0 }),
      ]),
    );
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
    expect(body.providers[0].error).toMatch(/503/);
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

describe("GET /api/out", () => {
  it("sets the edge cache header on a 200", async () => {
    const res = await GET(new Request("http://localhost/api/out?city=london&day=today"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=900",
    );
    const body = await res.json();
    expect(body.status === "ready" || body.status === "degraded").toBe(true);
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
