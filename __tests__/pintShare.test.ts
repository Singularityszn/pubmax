// "Share this pint" (P2-C): a figure never travels without its source and day.

import { describe, expect, it, vi } from "vitest";

import {
  PINT_SHARE_CARD_PARAM,
  PINT_SHARE_CARD_VALUE,
  buildPintShareText,
  pintShareCardImageUrl,
  pintShareCardVenue,
  pintShareFrom,
  pintShareSourceLine,
  pintShareUrl,
} from "@/lib/pintShare";
import { sharePint } from "@/lib/pintShareAction";
import { mapRequestNeedsDocumentTwin } from "@/lib/mapDocumentTwin";
import {
  listedCheapPintShare,
  nearTopPintShare,
  venuePintShare,
} from "@/lib/venuePintShare";

const READ = "2026-10-02T10:00:00.000Z";

const full = {
  venueId: "venue-crosse-keys",
  name: "The Crosse Keys",
  area: "City of London",
  priceGbp: 2.99,
  publisher: "whatpub.com",
  observedAt: READ,
};

describe("pintShareFrom: price, source and day travel together or not at all", () => {
  it("builds the share when every half is present", () => {
    expect(pintShareFrom(full)).toEqual({
      venueId: "venue-crosse-keys",
      name: "The Crosse Keys",
      area: "City of London",
      priceGbp: 2.99,
      publisher: "whatpub.com",
      readDay: "2 Oct",
    });
  });

  it.each([
    ["no price", { priceGbp: null }],
    ["a zero price", { priceGbp: 0 }],
    ["a negative price", { priceGbp: -1 }],
    ["a NaN price", { priceGbp: Number.NaN }],
    ["no publisher", { publisher: null }],
    ["a blank publisher", { publisher: "   " }],
    ["no read day", { observedAt: null }],
    ["an unreadable read day", { observedAt: "last week" }],
    ["no pub name", { name: "" }],
    ["no venue id", { venueId: "" }],
  ])("offers no share with %s", (_label, patch) => {
    expect(pintShareFrom({ ...full, ...patch })).toBeNull();
  });

  it("keeps a missing area as null rather than inventing one", () => {
    expect(pintShareFrom({ ...full, area: null })?.area).toBeNull();
  });
});

describe("the share text", () => {
  it("states the price, the pub, the publisher and the day in one line", () => {
    const share = pintShareFrom(full)!;
    expect(buildPintShareText(share)).toBe(
      "£2.99 a pint at The Crosse Keys (listed by whatpub.com, 2 Oct).",
    );
    expect(pintShareSourceLine(share)).toBe("listed by whatpub.com, 2 Oct");
  });

  it("never carries an em dash or an exclamation mark", () => {
    const text = buildPintShareText(pintShareFrom(full)!);
    expect(text).not.toMatch(/[—!]/);
  });
});

describe("the share link and its card", () => {
  it("is the pub's own map link, asking for the pint card, with no figure in it", () => {
    const url = pintShareUrl("venue-crosse-keys");
    expect(url).toBe(`/map?sel=venue-crosse-keys&${PINT_SHARE_CARD_PARAM}=${PINT_SHARE_CARD_VALUE}`);
    expect(url).not.toMatch(/2\.99|price|publisher/);
  });

  it("takes the /map document twin, because its preview differs", () => {
    expect(mapRequestNeedsDocumentTwin(pintShareUrl("venue-crosse-keys").split("?")[1]!)).toBe(true);
  });

  it("points the card at the venue id only", () => {
    expect(pintShareCardImageUrl("venue-a b")).toBe("/api/pint-card?venue=venue-a%20b");
  });

  it("reads a card request only for the pint value and a named venue", () => {
    expect(pintShareCardVenue("pint", "venue-a")).toBe("venue-a");
    expect(pintShareCardVenue(" PINT ", " venue-a ")).toBe("venue-a");
    expect(pintShareCardVenue("crawl", "venue-a")).toBeNull();
    expect(pintShareCardVenue("pint", "")).toBeNull();
    expect(pintShareCardVenue(undefined, "venue-a")).toBeNull();
  });
});

describe("venuePintShare: the one reading the sheet and the card share", () => {
  const venue = {
    id: "venue-crosse-keys",
    name: "The Crosse Keys",
    locality: "City of London",
    cheapestPrice: 2.99,
    prices: [
      {
        price_gbp: 2.99,
        pub_url: "https://whatpub.com/pubs/LON/1234/crosse-keys",
        scraped_at_values: READ,
      },
    ],
  };

  it("reads the exact figure's own publisher and read day", () => {
    const share = venuePintShare(venue as never);
    expect(share).toMatchObject({ priceGbp: 2.99, readDay: "2 Oct", area: "City of London" });
    expect(share?.publisher).toBeTruthy();
  });

  it("offers nothing for a pub with no price", () => {
    expect(venuePintShare({ ...venue, cheapestPrice: null, prices: [] } as never)).toBeNull();
  });

  it("offers nothing when the figure's row names no publisher", () => {
    expect(
      venuePintShare({
        ...venue,
        prices: [{ price_gbp: 2.99, pub_url: "", scraped_at_values: READ }],
      } as never),
    ).toBeNull();
  });

  it("offers nothing when the figure's row records no read", () => {
    expect(
      venuePintShare({
        ...venue,
        prices: [{ price_gbp: 2.99, pub_url: venue.prices[0]!.pub_url, scraped_at_values: "" }],
      } as never),
    ).toBeNull();
  });
});

describe("listedCheapPintShare: the pub sheet's one share moment", () => {
  const venue = {
    id: "venue-crosse-keys",
    name: "The Crosse Keys",
    locality: "City of London",
    cheapestPrice: 2.99,
    prices: [
      {
        price_gbp: 2.99,
        pub_url: "https://www.pint-prices.com/pub/crosse-keys",
        scraped_at_values: READ,
      },
    ],
  };

  it("shares a cheap pint listed by a named publisher on a known day", () => {
    expect(
      listedCheapPintShare(venue as never, { standing: "listed", cheapestPrice: 2.99 }, undefined),
    ).toMatchObject({ priceGbp: 2.99, publisher: "Pint Prices", readDay: "2 Oct" });
  });

  it("offers nothing for a standing short of listed", () => {
    for (const standing of ["estimate", "none"] as const) {
      expect(
        listedCheapPintShare(venue as never, { standing, cheapestPrice: 2.99 }, undefined),
      ).toBeNull();
    }
  });

  it("offers nothing for a pint that is not cheap", () => {
    const dear = {
      ...venue,
      cheapestPrice: 9.5,
      prices: [{ ...venue.prices[0]!, price_gbp: 9.5 }],
    };
    expect(
      listedCheapPintShare(dear as never, { standing: "listed", cheapestPrice: 9.5 }, undefined),
    ).toBeNull();
  });

  it("offers nothing when the block prints a different figure from the shared one", () => {
    expect(
      listedCheapPintShare(venue as never, { standing: "listed", cheapestPrice: 2.5 }, undefined),
    ).toBeNull();
  });
});

describe("nearTopPintShare: the /near top answer's one share moment", () => {
  const cards = [
    { id: "venue-a", name: "The Crosse Keys", borough: "City of London", cheapestPrice: 2.99 },
    { id: "venue-b", name: "The Other", borough: "Hackney", cheapestPrice: 3.2 },
  ];
  const trust = {
    status: "ready" as const,
    collectedAt: "2026-10-01",
    results: [
      { venueId: "venue-a", price: 2.99, publisher: "Pint Prices", observedAt: READ },
      { venueId: "venue-b", price: 3.2, publisher: "Pint Prices", observedAt: READ },
    ],
  };

  it("shares the top card's sourced, dated pint", () => {
    expect(nearTopPintShare(cards, trust)).toMatchObject({
      venueId: "venue-a",
      area: "City of London",
      priceGbp: 2.99,
      readDay: "2 Oct",
    });
  });

  it("offers nothing while the trust read is loading or absent", () => {
    expect(nearTopPintShare(cards, "loading")).toBeNull();
    expect(nearTopPintShare(cards, undefined)).toBeNull();
    expect(nearTopPintShare([], trust)).toBeNull();
  });

  it("offers nothing when the top figure's publisher or read is not on record", () => {
    const noPublisher = { ...trust, results: [{ ...trust.results[0]!, publisher: null }] };
    const noRead = { ...trust, results: [{ ...trust.results[0]!, observedAt: null }] };
    const otherFigure = { ...trust, results: [{ ...trust.results[0]!, price: 3.5 }] };
    expect(nearTopPintShare(cards, noPublisher)).toBeNull();
    expect(nearTopPintShare(cards, noRead)).toBeNull();
    expect(nearTopPintShare(cards, otherFigure)).toBeNull();
  });
});

describe("sharePint: the OS sheet first, then the clipboard", () => {
  const share = pintShareFrom(full)!;
  const origin = "https://pubmaxxing.com";

  it("hands the sheet the text and the absolute link", async () => {
    const shareFn = vi.fn(async () => undefined);
    const track = vi.fn();
    const outcome = await sharePint(share, {
      origin,
      nav: { share: shareFn },
      shareNatively: async () => "unavailable",
      track,
    });
    expect(outcome).toBe("shared");
    expect(shareFn).toHaveBeenCalledWith({
      title: "The Crosse Keys",
      text: "£2.99 a pint at The Crosse Keys (listed by whatpub.com, 2 Oct).",
      url: "https://pubmaxxing.com/map?sel=venue-crosse-keys&card=pint",
    });
    expect(track).toHaveBeenCalledWith("content_shared", { channel: "native", surface: "pint" });
  });

  it("copies the text and link when there is no sheet, and never opens WhatsApp", async () => {
    const writeText = vi.fn(async () => undefined);
    const track = vi.fn();
    const outcome = await sharePint(share, {
      origin,
      nav: { clipboard: { writeText } },
      shareNatively: async () => "unavailable",
      track,
    });
    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(
      "£2.99 a pint at The Crosse Keys (listed by whatpub.com, 2 Oct). https://pubmaxxing.com/map?sel=venue-crosse-keys&card=pint",
    );
    expect(track).toHaveBeenCalledWith("content_shared", { channel: "copy", surface: "pint" });
  });

  it("treats a dismissed sheet as the reader saying no", async () => {
    const writeText = vi.fn(async () => undefined);
    const abort = Object.assign(new Error("dismissed"), { name: "AbortError" });
    const outcome = await sharePint(share, {
      origin,
      nav: { share: async () => Promise.reject(abort), clipboard: { writeText } },
      shareNatively: async () => "unavailable",
      track: vi.fn(),
    });
    expect(outcome).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says it failed when neither the sheet nor the clipboard is there", async () => {
    expect(
      await sharePint(share, {
        origin,
        nav: {},
        shareNatively: async () => "unavailable",
        track: vi.fn(),
      }),
    ).toBe("failed");
  });
});
