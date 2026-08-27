import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const durable = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("@/lib/whatsOnListings.server", () => ({
  loadServedWhatsOnListingsWithFreshness: durable.load,
}));

import {
  buildOutResponse,
  loadServedOutListings,
} from "@/lib/out/loadOut";
import { buildOutVenueMatchIndex } from "@/lib/out/venueMatch";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-08-27T18:45:00.000Z");

function row(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "quiz-qo-pub-quiz-white-hart-whitechapel-thursdays",
    placeName: "White Hart, Whitechapel",
    kind: "quiz",
    startsAt: "2026-08-27T20:00:00+01:00",
    title: "Pub quiz - Thursdays 8pm",
    source: { label: "Question One", url: "https://example.com/quiz" },
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

const noLiveLane = [{
  name: "ticketmaster",
  isConfigured: () => false,
  fetchTonight: async () => [],
}];

beforeEach(() => {
  durable.load.mockReset();
});

describe("Out durable listings", () => {
  it("loads all Out listing kinds and keeps deals on Tonight", async () => {
    durable.load.mockResolvedValueOnce({
      rows: [row(), row({ id: "deal-1", kind: "deal", title: "Burger deal" })],
      providerObservedAt: "2026-08-27T11:07:30.691Z",
      readStatus: "ready",
    });

    const served = await loadServedOutListings("london", NOW);

    expect(served.rows.map((item) => item.kind)).toEqual(["quiz"]);
    const input = durable.load.mock.calls[0]?.[0] as {
      bundled: Array<{ id: string; kind: string; venueId?: string }>;
    };
    expect(input.bundled).toContainEqual(expect.objectContaining({
      id: "quiz-qo-pub-quiz-white-hart-whitechapel-thursdays",
      venueId: "venue-5cqxbo",
    }));
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
    const served = await loadServedOutListings("bristol", NOW);

    expect(served.rows).toEqual([]);
    expect(served.readStatus).toBe("ready");
    expect(durable.load).not.toHaveBeenCalled();
  });
});
