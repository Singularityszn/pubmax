import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import { matchVenueByNameKeyless, matchVenueNameWithinQuery } from "@/lib/ask/venueResolution";

const state = { venues: [] as ConciergeVenue[] };

vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: vi.fn(async () => state.venues),
}));
vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPricesWithStatus: vi.fn(async () => ({ prices: [], degraded: false })),
}));

import { runAskTool } from "@/lib/ask/tools";
import type { AskToolContext } from "@/lib/ask/toolContract";

// F13: the keyless Pub Pal could not find a pub named inside a sentence, and a
// "cheap pubs in Soho" plan was drawn from the few pubs whose text said Soho,
// so priced pubs a short walk from Soho Square never entered the pool.

const ctx = (query: string): AskToolContext =>
  ({ cityId: "london", query, now: Date.parse("2026-08-15T20:30:00.000Z"), skipModel: true });

function venue(overrides: Partial<ConciergeVenue> & { id: string; name: string }): ConciergeVenue {
  return {
    area: "Westminster",
    lat: 51.511,
    lng: -0.134,
    cheapestPrice: null,
    amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...overrides,
  };
}

beforeEach(() => {
  state.venues = [];
});

describe("a pub named inside a sentence", () => {
  const blackfriar = venue({ id: "bf", name: "The Blackfriar", area: "City of London", cheapestPrice: 6.5 });
  const other = venue({ id: "bf2", name: "The Black Friar, Blackfriars", area: "City of London" });

  it("finds it with or without the leading The, and ignores punctuation", () => {
    expect(matchVenueNameWithinQuery([other, blackfriar], "How much is a pint at The Blackfriar?")?.id).toBe("bf");
    expect(matchVenueNameWithinQuery([other, blackfriar], "pint at blackfriar tonight")?.id).toBe("bf");
    expect(matchVenueNameWithinQuery(
      [venue({ id: "qh", name: "The Queen’s Head" })],
      "is the queens head cheap",
    )?.id).toBe("qh");
  });

  it("prefers the longest name and refuses a tie between two pubs", () => {
    const crown = venue({ id: "c1", name: "The Crown" });
    const crownAnchor = venue({ id: "c2", name: "The Crown and Anchor" });
    expect(matchVenueNameWithinQuery([crown, crownAnchor], "pint at the crown and anchor")?.id).toBe("c2");
    expect(matchVenueNameWithinQuery([crown, venue({ id: "c3", name: "The Crown" })], "pint at the crown")).toBeNull();
  });

  it("matches whole words only and never on a short name", () => {
    expect(matchVenueNameWithinQuery([venue({ id: "x", name: "The Bell" })], "a pint at the bellwether")).toBeNull();
    expect(matchVenueNameWithinQuery([venue({ id: "x", name: "The Ox" })], "how much is a pint of ox blood")).toBeNull();
    expect(matchVenueNameWithinQuery([blackfriar], "a quiet pint in Soho")).toBeNull();
  });

  it("stays out of the bare-name matcher, so an unlisted name never lands on a shorter pub", () => {
    const crown = venue({ id: "c1", name: "The Crown" });
    expect(matchVenueByNameKeyless([blackfriar], "The Blackfriar")?.id).toBe("bf");
    expect(matchVenueByNameKeyless([blackfriar], "How much is a pint at The Blackfriar?")).toBeNull();
    expect(matchVenueByNameKeyless([crown], "The Crown & Sceptre")).toBeNull();
  });

  it("answers the listed price through the venue_prices tool", async () => {
    state.venues = [other, blackfriar];
    const result = await runAskTool("venue_prices", {}, ctx("How much is a pint at The Blackfriar?"));
    expect(result.ok).toBe(true);
    expect(result.answerHint).toContain("The Blackfriar");
    expect(result.answerHint).toContain("6.50");
    expect(result.cards.map((card) => card.price)).toContain(6.5);
  });
});

describe("a cheap plan in a named area", () => {
  it("draws from priced pubs inside the area, not only pubs whose text says Soho", async () => {
    state.venues = [
      venue({ id: "t1", name: "Comptons of Soho", searchText: "comptons of soho old compton street" }),
      venue({ id: "t2", name: "The Clachan", searchText: "the clachan soho kingly street" }),
      venue({ id: "t3", name: "The Ship Soho", searchText: "the ship soho wardour" }),
      venue({ id: "p1", name: "The Queen’s Head", cheapestPrice: 5.2, lat: 51.5111, lng: -0.1341 }),
      venue({ id: "p2", name: "The Coach & Horses", cheapestPrice: 5.7, lat: 51.514, lng: -0.131 }),
      venue({ id: "p3", name: "The Lemon Tree", cheapestPrice: 5.75, lat: 51.508, lng: -0.139 }),
      venue({ id: "far", name: "The Far Pub", cheapestPrice: 3, lat: 51.462, lng: -0.138 }),
    ];
    const result = await runAskTool("propose_plan", {}, ctx("Plan me 3 cheap pubs in Soho for four people"));
    expect(result.ok).toBe(true);
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(["p1", "p2", "p3"]);
    expect(result.cards.every((card) => typeof card.price === "number" && card.price <= 6)).toBe(true);
  });

  it("keeps the text rules for an area word that is not a night area", async () => {
    state.venues = [
      venue({ id: "k1", name: "The Lamb", area: "Camden" }),
      venue({ id: "k2", name: "The Oak", area: "Camden" }),
      venue({ id: "k3", name: "The Ash", area: "Camden" }),
      venue({ id: "w1", name: "The Elm", area: "Westminster" }),
    ];
    const result = await runAskTool("propose_plan", {}, ctx("Plan me 3 pubs in Camden"));
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(["k1", "k2", "k3"]);
  });
});
