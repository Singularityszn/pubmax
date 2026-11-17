import { describe, expect, it } from "vitest";

import {
  defaultSummonTime,
  formatSummonTime,
  parseSummonTime,
  summonSentLine,
  summonShareText,
  summonText,
  summonTimeFromSearch,
  venueSummonUrl,
} from "@/lib/summonMates";
import { selectSummonPrice } from "@/lib/summonPrice";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

describe("summon time", () => {
  it("accepts a 24-hour HH:MM and nothing else", () => {
    expect(parseSummonTime("20:30")).toBe("20:30");
    expect(parseSummonTime(" 07:05 ")).toBe("07:05");
    for (const bad of ["24:00", "8pm", "8:30", "20:60", "", null, 2030]) {
      expect(parseSummonTime(bad)).toBeNull();
    }
  });

  it("says the time the way a mate would", () => {
    expect(formatSummonTime("20:00")).toBe("8pm");
    expect(formatSummonTime("20:30")).toBe("8:30pm");
    expect(formatSummonTime("12:00")).toBe("12pm");
    expect(formatSummonTime("00:15")).toBe("12:15am");
  });

  it("suggests the next quarter hour at least 30 minutes away, on London's clock", () => {
    // 18:50 BST is 17:50 UTC: 19:20 rounds up to 19:30.
    expect(defaultSummonTime(new Date("2026-07-01T17:50:00Z"))).toBe("19:30");
    // 23:40 GMT wraps past midnight.
    expect(defaultSummonTime(new Date("2026-11-12T23:40:00Z"))).toBe("00:15");
  });
});

describe("summon link", () => {
  it("puts the time beside the city-aware pub link", () => {
    expect(venueSummonUrl("pub with spaces&x", "20:00")).toBe("/map?sel=pub%20with%20spaces%26x&meet=20%3A00");
    expect(venueSummonUrl("venue-mcr-1lwo5lo", "19:30")).toBe("/map/manchester?sel=venue-mcr-1lwo5lo&meet=19%3A30");
  });

  it("names a time only for the pub it was made for", () => {
    const search = new URL(venueSummonUrl("pub-a", "20:00"), "https://pubmaxxing.com").search;
    expect(summonTimeFromSearch(search, "pub-a")).toBe("20:00");
    expect(summonTimeFromSearch(search, "pub-b")).toBeNull();
    expect(summonTimeFromSearch("?sel=pub-a&meet=late", "pub-a")).toBeNull();
  });
});

describe("summon receipt", () => {
  it("names exactly the mates it reached", () => {
    expect(summonSentLine(["ann"])).toBe("Sent to @ann. They'll find it in Messages.");
    expect(summonSentLine(["ann", "bo", "cy"])).toBe("Sent to @ann, @bo and @cy. They'll find it in Messages.");
  });
});

// A dated price rides on a summon only when ONE row, the row behind the pub's
// listed figure, carries every fact the line prints: drink, stated measure,
// amount, the publisher's own page and a London read day no more than 30 days
// old. Anything less and the invite goes without a price.
describe("summon price", () => {
  const NOW = Date.parse("2026-11-17T12:00:00Z");
  const SOURCE = "https://www.pint-prices.com/pub/1%20Conduit%20Street/The%20Lamb";

  function row(overrides: Partial<VenuePrice> = {}): VenuePrice {
    return {
      app_price_id: "app_price_lamb_1",
      pub_name: "The Lamb",
      pint_name: "Amstel",
      measure: "pint",
      price_gbp: 5.5,
      price_text: "£5.50",
      address: "94 Lamb's Conduit Street, London, WC1N 3LZ",
      latitude: 51.5226,
      longitude: -0.1188,
      primary_borough: "Camden",
      boroughs_visible: "Camden",
      estimated_average_price_text: "",
      pub_url: SOURCE,
      source_datasets: "individual_pub_page",
      data_quality_notes: "",
      scraped_at_values: "2026-11-09T13:07:13+00:00",
      ...overrides,
    } as VenuePrice;
  }

  function pub(...rows: VenuePrice[]): Venue {
    const [venue] = groupVenuePrices(rows);
    return { ...venue!, id: "pub-lamb" };
  }

  it("takes drink, measure, amount, source and read day from the one row behind the listed figure", () => {
    const venue = pub(row({ app_price_id: "dear", pint_name: "Guinness", price_gbp: 6.8, price_text: "£6.80" }), row());
    expect(selectSummonPrice(venue, NOW)).toEqual({
      venueId: "pub-lamb",
      rowId: "app_price_lamb_1",
      drink: "Amstel",
      measure: "pint",
      amountGbp: 5.5,
      priceText: "£5.50",
      statement: null,
      sourceLabel: "Pint Prices",
      sourceUrl: SOURCE,
      observedAt: "2026-11-09T13:07:13.000Z",
      readDay: "2026-11-09",
    });
    expect(summonText("The Lamb", "20:00", selectSummonPrice(venue, NOW))).toBe(
      `Come to The Lamb at 8pm? Pint Prices listed Amstel (pint) at £5.50, read 9 November 2026. Source: ${SOURCE}`,
    );
  });

  it("puts the PUBMAXX link before the publisher's page in a priced share", () => {
    const map = "https://pubmaxxing.com/map?sel=pub-lamb&meet=20%3A00";
    const shared = summonShareText("The Lamb", "20:00", selectSummonPrice(pub(row()), NOW), map);
    expect(shared).toBe(
      `Come to The Lamb at 8pm? It's on the PUBMAXX map: ${map} Pint Prices listed Amstel (pint) at £5.50, read 9 November 2026. Source: ${SOURCE}`,
    );
    expect(shared.indexOf(map)).toBeLessThan(shared.indexOf(SOURCE));
  });

  it("keeps the price-free invite when no price is given", () => {
    expect(summonText("The Lamb", "20:00", null)).toBe("Come to The Lamb at 8pm?");
    expect(summonShareText("The Lamb", "20:00", null)).toBe("Come to The Lamb at 8pm? It's on the PUBMAXX map.");
  });

  it("quotes a conditional listing whole, conditions and all", () => {
    const statement = "£4.50 for members, Monday to Thursday before 7pm, £1 cup deposit";
    const evidence = selectSummonPrice(pub(row({ price_gbp: 4.5, price_text: statement })), NOW);
    expect(evidence).toMatchObject({ amountGbp: 4.5, priceText: statement, statement });
    expect(summonText("The Lamb", "20:00", evidence)).toBe(
      `Come to The Lamb at 8pm? Pint Prices listed Amstel (pint) as "${statement}", read 9 November 2026. Source: ${SOURCE}`,
    );
  });

  it("keeps a 160-character listing and drops a longer one whole, never cutting it", () => {
    const fits = `£4.50 members only ${"x".repeat(141)}`;
    expect(fits).toHaveLength(160);
    expect(selectSummonPrice(pub(row({ price_gbp: 4.5, price_text: fits })), NOW)?.statement).toBe(fits);
    expect(selectSummonPrice(pub(row({ price_gbp: 4.5, price_text: `${fits}y` })), NOW)).toBeNull();
  });

  it("never borrows another row's evidence for the cheapest figure", () => {
    const dear = row({ app_price_id: "dear", pint_name: "Guinness", price_gbp: 6.8, price_text: "£6.80" });
    expect(selectSummonPrice(pub(dear, row({ pub_url: "" })), NOW)).toBeNull();
    expect(selectSummonPrice(pub(dear, row({ measure: undefined })), NOW)).toBeNull();
    expect(selectSummonPrice(pub(dear, row({ scraped_at_values: "" })), NOW)).toBeNull();
  });

  it("reads 30 London calendar days as fresh and 31 as too old", () => {
    // 2026-10-17T23:30Z is 00:30 on 18 October in London: 30 days before 17 November.
    expect(selectSummonPrice(pub(row({ scraped_at_values: "2026-10-17T23:30:00Z" })), NOW)?.readDay).toBe("2026-10-18");
    expect(selectSummonPrice(pub(row({ scraped_at_values: "2026-10-17T22:30:00Z" })), NOW)).toBeNull();
  });

  it.each([
    ["no stated measure", { measure: undefined }],
    ["an unlabelled other measure", { measure: "other" }],
    ["a half sold under a pint", { pint_name: "Half of Amstel" }],
    ["a bottle sold under a pint", { pint_name: "Amstel 330ml bottle" }],
    ["a bottle labelled as a half", { measure: "half", pint_name: "Amstel 330ml bottle" }],
    ["a mismatched wine volume", { measure: "125ml", pint_name: "White wine 330ml" }],
    ["a mismatched half volume", { measure: "half", pint_name: "Amstel 568ml" }],
    ["a can labelled as a bottle", { measure: "bottle", pint_name: "Amstel 330ml can" }],
    ["a double labelled as a single", { measure: "single", pint_name: "Gin double" }],
    ["a parenthesised double labelled as a single", { measure: "single", pint_name: "Gin double (50ml)" }],
    ["a leading parenthesised double labelled as a single", { measure: "single", pint_name: "Double (50ml) gin" }],
    ["a bracketed double labelled as a single", { measure: "single", pint_name: "Gin double [50ml]" }],
    ["a double label before a volume", { measure: "single", pint_name: "Gin (double) 50ml" }],
    ["a double separated from its volume", { measure: "single", pint_name: "Gin double - 50ml" }],
    ["a double before its mixer", { measure: "single", pint_name: "Gin double with tonic" }],
    ["a hyphenated double gin", { measure: "single", pint_name: "Double-gin and tonic" }],
    ["a double with a serving separator", { measure: "single", pint_name: "Gin double / soda" }],
    ["a halfpint drink labelled as a pint", { pint_name: "Amstel halfpint" }],
    ["plural halfpints labelled as a pint", { pint_name: "Amstel halfpints" }],
    ["a pint name labelled as a half", { measure: "half", pint_name: "Amstel pint" }],
    ["a pint listing labelled as a half", { measure: "half", price_text: "£5.50 per pint" }],
    ["a mixed half and pint listing labelled as a half", { measure: "half", price_text: "Half pint £5.50 per pint" }],
    ["a single labelled as a double", { measure: "double", pint_name: "Gin single" }],
    ["a leading double labelled as a single", { measure: "single", pint_name: "Double gin and tonic" }],
    ["a spirit double labelled as a pint", { measure: "pint", pint_name: "Gin double" }],
    ["a spirit double listing labelled as a pint", { measure: "pint", pint_name: "Gordon's gin", price_text: "£5.50 double measure" }],
    ["a bottle listing labelled as a pint", { price_gbp: 5.5, price_text: "£5.50 per 330ml bottle" }],
    ["a half listing labelled as a pint", { price_text: "£5.50 a half" }],
    ["a conditional per-half listing labelled as a pint", { price_text: "£5.50 per half before 7pm" }],
    ["a conditional a-half listing labelled as a pint", { price_text: "£5.50 a half until 7pm" }],
    ["a weekday half listing labelled as a pint", { price_text: "£5.50 per half on weekdays" }],
    ["an unqualified half with a condition", { price_text: "£5.50 half before 7pm" }],
    ["plural halves with a condition", { price_text: "£5.50 halves before 7pm" }],
    ["a for-half listing with a condition", { price_text: "£5.50 for half before 7pm" }],
    ["an each-half listing with a condition", { price_text: "£5.50 each half before 7pm" }],
    ["a slash-separated half with a condition", { price_text: "£5.50/half before 7pm" }],
    ["a parenthesised half with a condition", { price_text: "£5.50 (a half) before 7pm" }],
    ["a parenthesised per-half with a condition", { price_text: "£5.50 (per half) on weekdays" }],
    ["a half separated from its condition by punctuation", { price_text: "£5.50 per half\u2014before 7pm" }],
    ["a drink name inside the half word", { pint_name: "Alf", price_text: "£5.50 per half before 7pm" }],
    ["a drink name at the start of the half word", { pint_name: "Hal", price_text: "£5.50 per half before 7pm" }],
    ["a half listing under a wine measure", { measure: "125ml", pint_name: "House wine", price_text: "£5.50 halves before 7pm" }],
    ["a half listing under a bottle measure", { measure: "bottle", pint_name: "Peroni", price_text: "£5.50 halves before 7pm" }],
    ["a half listing under a spirit measure", { measure: "single", pint_name: "Gin", price_text: "£5.50 halves before 7pm" }],
    ["a conditional schooner under a pint", { price_text: "£5.50 per schooner before 7pm" }],
    ["a conditional third under a pint", { price_text: "£5.50 a third before 7pm" }],
    ["conditional two-thirds under a pint", { price_text: "£5.50 per two-thirds on weekdays" }],
    ["a conditional small serving under a pint", { price_text: "£5.50 small before 7pm" }],
    ["a compound halfpint under a pint", { price_text: "£5.50 halfpint before 7pm" }],
    ["compound halfpints under a pint", { price_text: "£5.50 halfpints before 7pm" }],
    ["a conditional schooner under a half", { measure: "half", price_text: "£5.50 per schooner before 7pm" }],
    ["a conditional third under wine", { measure: "175ml", price_text: "£5.50 per third before 7pm" }],
    ["plural schooners under a pint", { price_text: "£5.50 schooners" }],
    ["a conditional single under a pint", { price_text: "£5.50 for a single before 7pm" }],
    ["a conditional single under a double", { measure: "double", price_text: "£5.50 for a single before 7pm" }],
    ["conditional singles under a double", { measure: "double", price_text: "£5.50 singles before 7pm" }],
    ["a conditional double under a single", { measure: "single", price_text: "£5.50 per double before 7pm" }],
    ["conditional doubles under a single", { measure: "single", price_text: "£5.50 doubles before 7pm" }],
    ["a matching half beside a conflicting schooner", { measure: "half", price_text: "£5.50 per half or schooner before 7pm" }],
    ["a matching double beside a conflicting single", { measure: "double", price_text: "£5.50 per single or double before 7pm" }],
    ["a can listing labelled as a bottle", { measure: "bottle", price_text: "£5.50 per 440ml can" }],
    ["a single listing labelled as a double", { measure: "double", pint_name: "Gordon's gin", price_text: "£5.50 single measure" }],
    ["markup in a publisher URL", { pub_url: "https://www.pint-prices.com/pub/<wrong>" }],
    ["no drink", { pint_name: " " }],
    ["no listing text", { price_text: "" }],
    ["a listing for another amount", { price_text: "£6.00" }],
    ["a listing that never states the amount", { price_text: "Two for £10 before 7pm" }],
    ["markup in the listing", { price_text: "£5.50 <b>members</b>" }],
    ["no publisher page", { pub_url: "" }],
    ["a future read", { scraped_at_values: "2026-11-18T09:00:00Z" }],
    ["a future read beside a past one", { scraped_at_values: "2026-11-09T13:07:13Z|2026-11-18T09:00:00Z" }],
    ["no read day", { scraped_at_values: "" }],
    ["a figure out of the pint band", { price_gbp: 1.99, price_text: "£1.99" }],
    ["no figure", { price_gbp: null, price_text: "", estimated_average_price_text: "£5.28" }],
  ])("omits the price for %s", (_label, overrides) => {
    expect(selectSummonPrice(pub(row(overrides as Partial<VenuePrice>)), NOW)).toBeNull();
  });

  it.each([
    ["half", "Amstel 284ml"],
    ["half", "Amstel half pint"],
    ["half", "Amstel half of a pint"],
    ["half", "Amstel ½ pint"],
    ["175ml", "White wine 175ml"],
    ["bottle", "Amstel 330ml bottle"],
    ["single", "Gin single"],
    ["double", "Gin double"],
    ["double", "Gin double (50ml)"],
    ["double", "Gin (double) 50ml"],
    ["double", "Gin double with tonic"],
    ["half", "Amstel halfpint"],
    ["double", "Double gin and tonic"],
    ["double", "Single Malt Whisky"],
    ["pint", "Double IPA"],
    ["pint", "Double Chocolate Stout"],
    ["pint", "Half Moon IPA"],
    ["pint", "Other Half Green Diamond"],
    ["pint", "A Half Decent Stout"],
  ] as const)("preserves a matching explicit %s serving for %s", (measure, pint_name) => {
    expect(selectSummonPrice(pub(row({ measure, pint_name })), NOW)?.measure).toBe(measure);
  });

  it("preserves a listing that states the same serving as its measure", () => {
    expect(selectSummonPrice(pub(row({ measure: "bottle", pint_name: "Peroni", price_text: "£5.50 per 330ml bottle" })), NOW))
      .toMatchObject({ measure: "bottle", statement: "£5.50 per 330ml bottle" });
    expect(selectSummonPrice(pub(row({ measure: "double", pint_name: "Gordon's gin", price_text: "£5.50 double measure" })), NOW))
      .toMatchObject({ measure: "double" });
    expect(selectSummonPrice(pub(row({ measure: "half", price_text: "£5.50 per half before 7pm" })), NOW))
      .toMatchObject({ measure: "half", statement: "£5.50 per half before 7pm" });
  });

  it.each([
    ["half", "£5.50 per halfpint before 7pm"],
    ["half", "£5.50 halfpints before 7pm"],
    ["single", "£5.50 per single before 7pm"],
    ["single", "£5.50 singles before 7pm"],
    ["double", "£5.50 per double before 7pm"],
    ["double", "£5.50 doubles before 7pm"],
  ] as const)("keeps the matching %s listing %s", (measure, price_text) => {
    expect(selectSummonPrice(pub(row({ measure, price_text })), NOW))
      .toMatchObject({ measure, statement: price_text });
  });

  it.each(["Half Moon IPA", "Other Half Green Diamond", "Half Moon (Cask)", "Small Beer Lager", "Third Wheel Bitter", "Double IPA"])("keeps %s as a drink name inside the listing", (pint_name) => {
    const price_text = `£5.50 for a ${pint_name} before 7pm`;
    expect(selectSummonPrice(pub(row({ pint_name, price_text })), NOW))
      .toMatchObject({ measure: "pint", drink: pint_name, statement: price_text });
  });

  it("never quotes a superseded row, a non-pub or a drinker's logged figure", () => {
    const superseded = row({
      app_price_id: "old",
      price_gbp: 3.5,
      price_text: "£3.50",
      price_superseded: {
        reason: "operator_change",
        operator: "Old Co",
        left_on: "2026-10-01",
        evidence: "Sold.",
        evidence_urls: ["https://example.com/sold"],
        recorded_on: "2026-10-02",
      },
    });
    const live = pub(row());
    expect(selectSummonPrice({ ...live, prices: [superseded, ...live.prices] }, NOW)?.rowId).toBe("app_price_lamb_1");
    expect(selectSummonPrice({ ...live, kind: "bar" }, NOW)).toBeNull();
    expect(selectSummonPrice({ ...live, cheapestPrice: 4.2, latestContributorPrice: 4.2 }, NOW)).toMatchObject({
      rowId: "app_price_lamb_1",
      amountGbp: 5.5,
    });
    expect(selectSummonPrice(null, NOW)).toBeNull();
  });
});
