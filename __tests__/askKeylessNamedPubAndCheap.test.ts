import { beforeEach, describe, expect, it, vi } from "vitest";

import { areaCircleForAsk } from "@/lib/concierge/areaCircle";
import { rankConciergeVenues, type ConciergeVenue } from "@/lib/concierge/rank";
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
    expect(matchVenueNameWithinQuery([other, blackfriar], "pint at THE BLACKFRIAR tonight")?.id).toBe("bf");
    const queensHead = venue({ id: "qh", name: "The Queen’s Head" });
    expect(matchVenueNameWithinQuery([queensHead], "is the queens head cheap")?.id).toBe("qh");
    expect(matchVenueNameWithinQuery([queensHead], "pint at queens head tonight")?.id).toBe("qh");
  });

  it("prefers the longest name and refuses a tie between two pubs", () => {
    const crown = venue({ id: "c1", name: "The Crown" });
    const crownAnchor = venue({ id: "c2", name: "The Crown and Anchor" });
    expect(matchVenueNameWithinQuery([crown, crownAnchor], "pint at the crown and anchor")?.id).toBe("c2");
    expect(matchVenueNameWithinQuery([crown, venue({ id: "c3", name: "The Crown" })], "pint at the crown")).toBeNull();
  });

  it("matches whole words only and never on a one-word name", () => {
    expect(matchVenueNameWithinQuery([venue({ id: "x", name: "The Bell" })], "a pint at the bellwether")).toBeNull();
    expect(matchVenueNameWithinQuery([venue({ id: "x", name: "The Ox" })], "how much is a pint of ox blood")).toBeNull();
    expect(matchVenueNameWithinQuery([blackfriar], "a quiet pint in Soho")).toBeNull();
    expect(matchVenueNameWithinQuery([blackfriar], "pint at blackfriar tonight")).toBeNull();
  });

  // Real listed pubs whose name is part of, or is, a London place name.
  const placeWordPubs = [
    venue({ id: "venue-p99zi1", name: "The Bridge", area: "Richmond upon Thames", cheapestPrice: 5.55 }),
    venue({ id: "venue-k9vek2", name: "The Kings", area: "Islington", cheapestPrice: 4.4 }),
    venue({ id: "venue-1n6ephn", name: "The Court", area: "Westminster", cheapestPrice: 6.6 }),
    venue({ id: "venue-1u69mia", name: "The Junction", area: "Islington", cheapestPrice: 6.4 }),
    venue({ id: "venue-1dre7k9", name: "The Holland", area: "Kensington and Chelsea", cheapestPrice: 7.5 }),
    venue({ id: "venue-87c76k", name: "The Hill", area: "Lewisham", cheapestPrice: 4.85 }),
    venue({ id: "venue-1ep9lhe", name: "Elephant and Castle", area: "Greenwich", cheapestPrice: null }),
  ];
  const placeQuestions = [
    "How much is a pint near London Bridge",
    "How much is a pint near Kings Cross",
    "How much is a pint in Earls Court",
    "How much is a pint around Clapham Junction",
    "How much is a pint in Holland Park",
    "How much is a pint near Harrow on the Hill",
    "How much is a pint near the Kings Cross station",
    "How much is a pint in the Holland Park area",
    "How much is a pint near the London Bridge end",
    "How much is a pint near the Elephant and Castle",
  ];

  it.each(placeQuestions)("finds no pub in the place name of %s", (question) => {
    expect(matchVenueNameWithinQuery(placeWordPubs, question)).toBeNull();
  });

  it("still finds those pubs when the question names them", () => {
    expect(matchVenueNameWithinQuery(placeWordPubs, "How much is a pint at The Bridge?")?.id).toBe("venue-p99zi1");
    expect(matchVenueNameWithinQuery(placeWordPubs, "pint at the kings tonight")?.id).toBe("venue-k9vek2");
  });

  it.each(placeQuestions)("gives no listed price for %s", async (question) => {
    state.venues = placeWordPubs;
    const result = await runAskTool("venue_prices", {}, ctx(question));
    expect(result.ok).toBe(false);
    expect(result.answerHint).toBe("Name a listed pub to check a price.");
  });

  it.each([
    "tell me about the history of Kings Cross",
    "tell me about the history of the Kings Cross area",
  ])("tells no pub's history for %s", async (question) => {
    state.venues = placeWordPubs;
    const result = await runAskTool("venue_heritage", {}, ctx(question));
    expect(result.ok).toBe(false);
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
    expect(areaCircleForAsk("london", "Hackney")).toBeUndefined();
    state.venues = [
      venue({ id: "k1", name: "The Lamb", area: "Hackney" }),
      venue({ id: "k2", name: "The Oak", area: "Hackney" }),
      venue({ id: "k3", name: "The Ash", area: "Hackney" }),
      venue({ id: "w1", name: "The Elm", area: "Westminster", cheapestPrice: 3 }),
    ];
    const result = await runAskTool("propose_plan", {}, ctx("Plan me 3 pubs in Hackney"));
    expect(result.cards.map((card) => card.venueId).sort()).toEqual(["k1", "k2", "k3"]);
  });
});

describe("a pub the area circle alone finds", () => {
  // Real listed pubs: two inside the Piccadilly & Soho circle whose own data
  // never says Soho, and one whose address does.
  const adamAndEve = venue({
    id: "venue-s4j91a",
    name: "Adam & Eve (St James)",
    lat: 51.4995,
    lng: -0.135676,
    cheapestPrice: 5.4,
    searchText: "adam & eve (st james) 81 petty france, sw1h 9ex westminster",
  });
  const threeTuns = venue({
    id: "venue-p7p18j",
    name: "The Three Tuns - LSE Student Union",
    lat: 51.5148,
    lng: -0.117513,
    cheapestPrice: 2.95,
    searchText: "the three tuns - lse student union saw swee hock student centre wc2b, london westminster",
  });
  const shakespearesHead = venue({
    id: "venue-e1srzr",
    name: "Shakespeares Head (Soho)",
    lat: 51.5137,
    lng: -0.139559,
    cheapestPrice: 6.25,
    searchText: "shakespeares head (soho) 29 great malborough street, w1f 7hz westminster",
  });

  it("is near the area with its distance, never in it", () => {
    const ranked = rankConciergeVenues(
      [adamAndEve, threeTuns, shakespearesHead],
      { mood: [], groupSize: 4, area: "Soho", maxPintPrice: 6.5 },
      { limit: 3, areaCircle: areaCircleForAsk("london", "Soho") },
    );
    const reasonsFor = (id: string) => ranked.find((row) => row.venue.id === id)?.reasons ?? [];
    expect(reasonsFor("venue-s4j91a")).toEqual(["£5.40 is within budget", "Near Soho, 1.3 km"]);
    expect(reasonsFor("venue-p7p18j")).toEqual(["£2.95 is within budget", "Near Soho, 1.2 km"]);
    expect(reasonsFor("venue-e1srzr")).toEqual(["£6.25 is within budget", "In Soho"]);
    expect(ranked.flatMap((row) => row.reasons).filter((reason) => reason === "In Soho")).toHaveLength(1);
  });

  it("scores below the same pub in the area by its own data", () => {
    const intent = { mood: [], groupSize: 4, area: "Soho", maxPintPrice: 6.5 };
    const options = { limit: 3, areaCircle: areaCircleForAsk("london", "Soho") };
    const near = rankConciergeVenues([adamAndEve], intent, options)[0]!;
    const inSoho = rankConciergeVenues(
      [{ ...adamAndEve, searchText: "adam & eve 1 dean street, soho" }],
      intent,
      options,
    )[0]!;
    expect(inSoho.score - near.score).toBe(10);
  });
});
