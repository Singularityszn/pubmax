import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { DeskVenueRead } from "@/lib/ask/deskVenues.server";

const state = {
  venues: [] as ConciergeVenue[],
  prices: { prices: [] as CommunityPrice[], degraded: false },
  whatsOn: { rows: [] as WhatsOnRow[], kindObservedAt: {} },
  whatsOnThrows: false,
  desk: { venues: [], status: "ready" } as DeskVenueRead,
};

vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: vi.fn(async () => state.venues),
}));

vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPricesWithStatus: vi.fn(async () => state.prices),
}));

vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: vi.fn(async () => {
    if (state.whatsOnThrows) throw new Error("down");
    return state.whatsOn;
  }),
}));

vi.mock("@/lib/ask/deskVenues.server", () => ({
  loadDeskVenues: vi.fn(async () => state.desk),
}));

import { runAskTool } from "@/lib/ask/tools";
import type { AskToolContext } from "@/lib/ask/toolContract";

const NOW = Date.parse("2026-08-15T20:30:00.000Z");

function ctx(overrides: Partial<AskToolContext> = {}): AskToolContext {
  return { cityId: "london", query: "", now: NOW, skipModel: true, ...overrides };
}

function venue(overrides: Partial<ConciergeVenue> & { id: string; name: string }): ConciergeVenue {
  return {
    area: "Camden",
    lat: 51.5,
    lng: -0.13,
    cheapestPrice: 5,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...overrides,
  };
}

function price(overrides: Partial<CommunityPrice> = {}): CommunityPrice {
  return {
    venueId: "v1",
    drinkCategory: "beer",
    priceGbp: 5.4,
    submittedAt: NOW - 86_400_000,
    source: "community",
    corroborations: 2,
    ...overrides,
  } as CommunityPrice;
}

beforeEach(() => {
  state.venues = [];
  state.prices = { prices: [], degraded: false };
  state.whatsOn = { rows: [], kindObservedAt: {} };
  state.whatsOnThrows = false;
  state.desk = { venues: [], status: "ready" };
});

describe("cheapest_pint_near", () => {
  it("ranks the listed pints round a named pub and leaves the anchor out", async () => {
    state.venues = [
      venue({ id: "anchor", name: "The Lamb", cheapestPrice: 4 }),
      venue({ id: "near-cheap", name: "The Crown", lat: 51.5005, cheapestPrice: 4.5 }),
      venue({ id: "near-dear", name: "The Ship", lat: 51.5008, cheapestPrice: 6.2 }),
    ];
    const result = await runAskTool("cheapest_pint_near", { venueName: "The Lamb" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId)).toEqual(["near-cheap", "near-dear"]);
    expect(result.answerHint).toContain("The Crown at £4.50");
    for (const card of result.cards) {
      expect(card.provenance?.label).toBe("On record");
    }
  });

  it("answers an area ask from the borough list", async () => {
    state.venues = [
      venue({ id: "a", name: "The Crown", area: "Camden", cheapestPrice: 6 }),
      venue({ id: "b", name: "The Ship", area: "Camden", cheapestPrice: 4.2 }),
      venue({ id: "c", name: "The Anchor", area: "Hackney", cheapestPrice: 3 }),
    ];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.cards.map((card) => card.venueId)).toEqual(["b", "a"]);
    expect(result.answerHint).toContain("Cheapest listed pints in Camden");
  });

  it("asks for an anchor instead of guessing one", async () => {
    state.venues = [venue({ id: "a", name: "The Crown" })];
    const result = await runAskTool("cheapest_pint_near", {}, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toContain("Name a listed pub");
    expect(result.cards).toHaveLength(0);
  });

  it("degrades honestly when the listed index could not be read", async () => {
    state.venues = [];
    const result = await runAskTool("cheapest_pint_near", { area: "Camden" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read");
  });
});

describe("tonight_now", () => {
  it("splits running from still-to-start and never claims a crowd reading", async () => {
    state.whatsOn = {
      rows: [
        {
          id: "running",
          placeName: "The Lamb",
          kind: "quiz",
          title: "Quiz night",
          startsAt: "2026-08-15T20:00:00.000Z",
          endsAt: "2026-08-15T22:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
        {
          id: "later",
          placeName: "The Crown",
          kind: "music",
          title: "Live set",
          startsAt: "2026-08-15T22:30:00.000Z",
          endsAt: "2026-08-16T00:00:00.000Z",
          source: { label: "Venue site", url: "https://example.com" },
          observedAt: "2026-08-15T09:00:00.000Z",
          confidence: "listed",
        },
      ],
      kindObservedAt: {},
    };
    const result = await runAskTool("tonight_now", {}, ctx());
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("1 on right now");
    expect(result.answerHint).toContain("1 still to start tonight");
    expect(result.answerHint).toContain("can't tell you what's quiet");
    expect(result.cards[0]?.note).toBe("On right now");
  });

  it("degrades rather than reading a failed listing load as a quiet city", async () => {
    state.whatsOnThrows = true;
    const result = await runAskTool("tonight_now", { area: "Soho" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read tonight's listings");
  });
});

describe("venue_drinks", () => {
  it("prints one row per drink with its own tag, figure and standing", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: 5 })];
    state.prices = {
      prices: [
        price({ drinkCategory: "beer", priceGbp: 5.4, corroborations: 2 }),
        price({ drinkCategory: "wine", priceGbp: 8, corroborations: 1 }),
      ],
      degraded: false,
    };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.cards.map((card) => card.price)).toEqual([5.4, 8, 5]);
    expect(result.cards[0]?.note).toContain("reaches the map");
    expect(result.cards[1]?.note).toContain("stays on this pub's page");
    expect(result.cards[2]?.provenance?.label).toBe("On record");
  });

  it("says nobody has logged one rather than inventing a figure", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: null })];
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).toContain("No drink prices logged at The Lamb yet");
  });

  it("separates a failed read from an unlogged pub", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb", cheapestPrice: null })];
    state.prices = { prices: [], degraded: true };
    const result = await runAskTool("venue_drinks", { venueId: "v1" }, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read what people have logged");
  });
});

describe("find_desk", () => {
  it("says no seat data yet while the pack carries no work-friendly rows", async () => {
    state.desk = { venues: [], status: "ready" };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.cards).toHaveLength(0);
    expect(result.answerHint).toContain("No seat data yet");
    expect(result.answerHint).toContain("Angel");
  });

  it("answers from work-friendly rows and still admits the missing facts", async () => {
    state.desk = {
      status: "ready",
      venues: [
        { id: "c1", name: "Bean Counter", area: "Angel", lat: 51.53, lng: -0.1, kind: "cafe" },
      ],
    };
    const result = await runAskTool("find_desk", { area: "Angel" }, ctx());
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.note).toContain("no seat or wifi report on record");
    expect(result.answerHint).toContain("No seat or wifi report on any of them yet.");
  });

  it("degrades when the pack could not be read", async () => {
    state.desk = { venues: [], status: "unavailable" };
    const result = await runAskTool("find_desk", {}, ctx());
    expect(result.degraded).toBe(true);
    expect(result.answerHint).toContain("couldn't read the places list");
  });
});

describe("report_occupancy", () => {
  it("writes nothing and offers no confirm while the crowd store is unbuilt", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool(
      "report_occupancy",
      { venueName: "The Lamb", level: "rammed" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(result.proposals).toHaveLength(0);
    expect(result.answerHint).toContain("Full at The Lamb");
    expect(result.answerHint).toContain("nowhere to land");
  });

  it("asks which pub before taking a report", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool("report_occupancy", { level: "full" }, ctx());
    expect(result.ok).toBe(false);
    expect(result.answerHint).toContain("Name the pub");
  });

  it("asks for the level when the words carry none", async () => {
    state.venues = [venue({ id: "v1", name: "The Lamb" })];
    const result = await runAskTool(
      "report_occupancy",
      { venueName: "The Lamb", level: "mustard" },
      ctx(),
    );
    expect(result.answerHint).toBe("Is The Lamb empty, some seats, or full?");
  });
});
