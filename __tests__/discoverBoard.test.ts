import { describe, expect, it } from "vitest";

import {
  DISCOVER_BOARD_LIMIT,
  DISCOVER_BOARD_PATH,
  discoverBaselineSourceUrl,
  discoverBoardFromVenues,
  parseDiscoverBoard,
} from "@/lib/discoverBoard";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";
import shipped from "../public/data/discover/board.json";

// The fence over the Discover board: the shipped artifact must be exactly what
// `npm run build:discover-board` cuts from the bundled dataset today. Discover
// prints these rows to a stranger, so a board that has drifted from the dataset
// is a wrong price on a public page, and a stale board can no longer hide
// behind "the browser recomputes it anyway" now that the browser does not.

const venues = groupVenuePrices(dataset as VenuePrice[]);

describe("the shipped Discover board", () => {
  it("is byte-for-byte what the dataset yields today", () => {
    const rebuilt = discoverBoardFromVenues(
      venues,
      PINT_DATASET_OBSERVED_AT.toISOString(),
    );
    expect(shipped).toEqual(rebuilt);
  });

  it("dates the collection day, never the day it was written", () => {
    expect(shipped.observedAt).toBe(PINT_DATASET_OBSERVED_AT.toISOString());
  });

  it("ranks the published number of rows and holds every priced baseline", () => {
    expect(shipped.cheapest).toHaveLength(DISCOVER_BOARD_LIMIT);
    expect(shipped.baselines.length).toBe(
      venues.filter((venue) => typeof venue.cheapestPrice === "number").length,
    );
    expect(shipped.baselines.every((row) => row.drink.trim() !== "")).toBe(true);
    expect(shipped.baselines.every((row) => row.sourceId.trim() !== "")).toBe(true);
    expect(shipped.baselines.filter((row) => row.sourceRef).length).toBeGreaterThan(800);
  });

  it("is a fraction of the dataset it replaces", () => {
    // The browser used to fetch ~6.87 MB to print ten rows. Guard the size the
    // page now pays for, so a future field on a baseline row cannot quietly
    // walk it back up.
    const bytes = Buffer.byteLength(JSON.stringify(shipped), "utf8");
    expect(bytes).toBeLessThan(200_000);
  });

  it("is served from the path the page reads", () => {
    expect(DISCOVER_BOARD_PATH).toBe("/data/discover/board.json");
  });
});

describe("parseDiscoverBoard", () => {
  it("reads the shipped board back", () => {
    const parsed = parseDiscoverBoard(shipped);
    expect(parsed?.cheapest).toHaveLength(DISCOVER_BOARD_LIMIT);
    expect(parsed?.baselines.length).toBe(shipped.baselines.length);
  });

  it("answers null for a body that is not a board", () => {
    expect(parseDiscoverBoard(null)).toBeNull();
    expect(parseDiscoverBoard("nope")).toBeNull();
    expect(parseDiscoverBoard({})).toBeNull();
    expect(parseDiscoverBoard({ cheapest: [], baselines: {} })).toBeNull();
  });

  it("drops a row it cannot read and keeps the rest", () => {
    const parsed = parseDiscoverBoard({
      observedAt: "2026-01-01T00:00:00.000Z",
      cheapest: [
        {
          rank: 1,
          area: "Southwark",
          standing: "listed",
          venue: { id: "a", name: "A", cheapestPint: "Lager", cheapestPrice: 4 },
        },
        { rank: 2, area: "Camden", standing: "listed", venue: { id: "b", name: "B", cheapestPrice: null } },
      ],
      baselines: [
        {
          id: "a",
          name: "A",
          cheapestPrice: 4,
          drink: "Lager",
          sourceId: "app_price_000001",
          sourceRef: "/pub/the-test-arms",
        },
        { id: "", name: "B", cheapestPrice: 5 },
      ],
    });
    expect(parsed?.cheapest.map((row) => row.venue.id)).toEqual(["a"]);
    expect(parsed?.baselines.map((row) => row.id)).toEqual(["a"]);
    expect(parsed?.baselines[0]).toMatchObject({
      drink: "Lager",
      sourceId: "app_price_000001",
      sourceRef: "/pub/the-test-arms",
    });
  });

  it("resolves compact source references without allowing an origin escape", () => {
    expect(discoverBaselineSourceUrl("/pub/the-test-arms")).toBe(
      "https://www.pint-prices.com/pub/the-test-arms",
    );
    expect(discoverBaselineSourceUrl("https://tattoo-bar.co.uk/menu")).toBe(
      "https://tattoo-bar.co.uk/menu",
    );
    expect(discoverBaselineSourceUrl("//example.com/not-the-source")).toBeNull();
    expect(discoverBaselineSourceUrl("javascript:alert(1)")).toBeNull();
  });

  // A figure without its trust word is the unlabelled board the captain
  // refused, so an unstamped row is dropped rather than given a default.
  it("drops a row carrying no standing, and one carrying a word that is not one", () => {
    const parsed = parseDiscoverBoard({
      observedAt: "2026-01-01T00:00:00.000Z",
      cheapest: [
        { rank: 1, area: "Southwark", venue: { id: "a", name: "A", cheapestPrice: 4 } },
        { rank: 2, area: "Camden", standing: "cheap", venue: { id: "b", name: "B", cheapestPrice: 5 } },
        { rank: 3, area: "Hackney", standing: "listed", venue: { id: "c", name: "C", cheapestPrice: 6 } },
      ],
      baselines: [],
    });
    expect(parsed?.cheapest.map((row) => row.venue.id)).toEqual(["c"]);
  });
});
