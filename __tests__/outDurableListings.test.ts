// The durable What's-On store holds only the bounded London refresh's rows.
// Out's baseline may read it for London alone - London listings under another
// city's query is worse than saying nothing - and a durable read that failed
// must report degraded instead of serving the bundled fallback as "ready".
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const durable = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("@/lib/whatsOnListings.server", () => ({
  loadServedWhatsOnListingsWithFreshness: durable.load,
}));

import { buildOutResponse, loadServedOutEvents } from "@/lib/out/loadOut";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-08-27T18:45:00.000Z");

function row(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "tm-white-hart-jazz",
    placeName: "White Hart, Whitechapel",
    lat: 51.5202,
    lng: -0.0562,
    kind: "event",
    startsAt: "2026-08-27T20:00:00+01:00",
    endsAt: "2026-08-27T23:00:00+01:00",
    title: "Live jazz",
    source: { label: "Ticketmaster", url: "https://example.com/jazz" },
    observedAt: "2026-08-27T11:07:30.691Z",
    confidence: "listed",
    venueId: "venue-5cqxbo",
    ...overrides,
  };
}

const venueIndex = buildOutVenueMatchIndex([
  {
    id: "venue-5cqxbo",
    name: "The White Hart",
    borough: "Tower Hamlets",
    lat: 51.5202,
    lng: -0.0562,
  },
]);

const noLiveLane = [
  {
    name: "ticketmaster",
    isConfigured: () => false,
    fetchTonight: async () => [],
  },
];

beforeEach(() => {
  durable.load.mockReset();
});

describe("Out durable listings", () => {
  it("asks the durable store for London events only", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [row()],
      providerObservedAt: "2026-08-27T11:07:30.691Z",
      readStatus: "ready",
    });

    const served = await loadServedOutEvents("london", NOW);

    expect(served.rows.map((item) => item.id)).toEqual(["tm-white-hart-jazz"]);
    expect(served.readStatus).toBe("ready");
    expect(durable.load).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "event" }),
    );
  });

  it("keeps a failed durable read degraded while serving bundled fallback", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [row()],
      providerObservedAt: null,
      readStatus: "degraded",
    });

    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: NOW,
        liveProviders: noLiveLane,
        loadVenueMatchIndex: async () => venueIndex,
      },
    );

    expect(body.listingsStatus).toBe("degraded");
    expect(body.events).toHaveLength(1);
  });

  it("keeps a failed empty durable read degraded instead of not configured", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [],
      providerObservedAt: null,
      readStatus: "degraded",
    });

    const body = await buildOutResponse(
      { city: "london", day: "today" },
      {
        now: NOW,
        liveProviders: noLiveLane,
        loadVenueMatchIndex: async () => venueIndex,
      },
    );

    expect(body.listingsStatus).toBe("degraded");
    expect(body.events).toEqual([]);
  });

  it("never reads London durable rows for another city", async () => {
    const served = await loadServedOutEvents("bristol", NOW);

    expect(served.readStatus).toBe("ready");
    expect(durable.load).not.toHaveBeenCalled();
  });
});

describe("Out city scope", () => {
  it.each(["today", "tomorrow", "weekend"] as const)("keeps only grounded London locations for %s", async (day) => {
    const now = Date.parse("2026-11-15T13:45:00Z");
    const startsAt = day === "tomorrow" ? "2026-11-16T19:00:00Z" : "2026-11-15T19:00:00Z";
    const listing = (id: string, overrides: Partial<WhatsOnRow>) => row({
      id, sourceId: id, title: id, startsAt, endsAt: undefined, venueId: undefined,
      lat: undefined, lng: undefined, ...overrides,
    });
    const body = await buildOutResponse({ city: "london", day }, {
      now, loadVenueMatchIndex: async () => venueIndex,
      loadBaseline: () => [
        listing("swansea", { title: "The Shires", placeName: "Swansea Building Society Arena", lat: 51.6178, lng: -3.9439 }),
        listing("partial-point", { lat: 51.51 }),
        listing("invalid-point", { lat: Number.NaN, lng: -0.12 }),
        listing("unknown", { title: "London Symphony", placeName: "Unknown arena", area: "piccadilly-soho" }),
        listing("forged", { placeName: "White Hart, Whitechapel", venueId: "venue-5cqxbo", lat: 51.6178, lng: -3.9439 }),
        listing("pub", { placeName: "The White Hart", venueId: "venue-5cqxbo" }),
      ],
      liveProviders: [{ name: "ticketmaster", isConfigured: () => true, fetchTonight: async () => [
        listing("london", { title: "The Shires", placeName: "Unlisted London room", lat: 51.51, lng: -0.12 }),
        listing("live-swansea", { placeName: "Swansea Building Society Arena", lat: 51.6178, lng: -3.9439 }),
        listing("live-unknown", { title: "London Jazz", placeName: "Unlocated room" }),
      ] }],
    });
    expect(body.events.map((event) => event.id).sort()).toEqual(["london", "pub"]);
    expect(body.unmatchedCount).toBe(1);
    expect(body.unmatchedPlaces).toEqual(["Unlisted London room"]);
  });
});

it("keeps grounded coordinates when the city pub index is unavailable", async () => {
  const body = await buildOutResponse({ city: "london", day: "today" }, {
    now: NOW, loadVenueMatchIndex: async () => null, liveProviders: [],
    loadBaseline: () => [row(), row({ id: "unknown", lat: undefined, lng: undefined })],
  });
  expect(body.venueMatch).toBe("unavailable");
  expect(body.events.map((event) => event.id)).toEqual(["tm-white-hart-jazz"]);
});
