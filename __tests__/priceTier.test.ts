import { describe, expect, it } from "vitest";

import {
  CONFIRMED_MAX_AGE_DAYS,
  LISTED_MAX_AGE_DAYS,
  PRICE_STANDINGS,
  listedPriceExpired,
  oldListedPriceLine,
  priceStandingFigure,
  priceStandingFor,
  priceStandingLabel,
  priceStandingNote,
  standingCarriesAuthority,
} from "@/lib/priceTier";
import * as priceTierModule from "@/lib/priceTier";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe("price standings", () => {
  it("names four standings and gives every one a label and a note, and no tone", () => {
    expect(PRICE_STANDINGS).toEqual(["confirmed", "listed", "estimate", "none"]);
    // Colour on a price is its BAND (lib/priceBand.ts), never its standing.
    expect("PRICE_STANDING_TONE" in priceTierModule).toBe(false);
    for (const standing of PRICE_STANDINGS) {
      expect(priceStandingLabel(standing).length).toBeGreaterThan(0);
      expect(priceStandingNote(standing).length).toBeGreaterThan(0);
    }
  });

  it("takes the strongest claim the evidence supports", () => {
    const decision = priceStandingFor(
      {
        confirmed: { priceGbp: 5.4, observedAt: daysAgo(2) },
        listed: { priceGbp: 5.9, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(2) },
        estimate: { priceGbp: 6.2, basis: "chain_menu", sampleSize: 12, computedAt: daysAgo(1) },
      },
      NOW,
    );
    expect(decision.standing).toBe("confirmed");
    expect(decision.priceGbp).toBe(5.4);
  });

  it("expires a confirmation past its window and falls through to the listed price", () => {
    const decision = priceStandingFor(
      {
        confirmed: { priceGbp: 5.4, observedAt: daysAgo(CONFIRMED_MAX_AGE_DAYS + 1) },
        listed: { priceGbp: 5.9, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(10) },
      },
      NOW,
    );
    expect(decision.standing).toBe("listed");
    expect(decision.sourceUrl).toBe("https://pub.example/menu");
  });

  it("expires a listed price past its own window and reports why", () => {
    const menu = (days: number) => ({ priceGbp: 5.9, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(days) });
    expect(priceStandingFor({ listed: menu(180) }, NOW).standing).toBe("listed");
    expect(priceStandingFor({ listed: menu(181) }, NOW).reason).toBe("listed_expired");
    const decision = priceStandingFor(
      { listed: { priceGbp: 5.9, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(LISTED_MAX_AGE_DAYS + 1) } },
      NOW,
    );
    expect(decision.standing).toBe("none");
    expect(decision.reason).toBe("listed_expired");
    expect(decision.priceGbp).toBeNull();
  });

  it("never lets an April listing read as current in November, and keeps it only as an old price", () => {
    const today = Date.parse("2026-11-23T12:00:00.000Z");
    const april = { priceGbp: 5.85, sourceUrl: "https://guinndex.example/pub", observedAt: "2026-04-11", publisher: "Guinndex" };
    const estimate = { priceGbp: 5.5, basis: "postcode_area:LL", sampleSize: 26, computedAt: "2026-11-23T07:45:21.844Z" };

    const withEstimate = priceStandingFor({ listed: april, estimate }, today);
    expect(withEstimate.standing).toBe("estimate");
    expect(priceStandingFigure(withEstimate)).toBe("est. £5.50");
    expect(withEstimate.sourceUrl).toBeNull();
    expect(withEstimate.oldListed).toEqual(april);

    const alone = priceStandingFor({ listed: april }, today);
    expect(alone.standing).toBe("none");
    expect(priceStandingFigure(alone)).toBeNull();
    expect(alone.oldListed).toEqual(april);

    expect(listedPriceExpired(april.observedAt, today)).toBe(true);
    expect(oldListedPriceLine(april, today)).toBe("£5.85 in April, may have changed");
    expect(oldListedPriceLine({ priceGbp: 4, observedAt: "2025-12-02" }, today)).toBe("£4.00 in December 2025, may have changed");
  });

  it("calls a listing expired only when its read day is past the window", () => {
    expect(listedPriceExpired(daysAgo(LISTED_MAX_AGE_DAYS), NOW)).toBe(false);
    expect(listedPriceExpired(daysAgo(LISTED_MAX_AGE_DAYS + 1), NOW)).toBe(true);
    expect(listedPriceExpired(daysAgo(-3), NOW)).toBe(false);
    expect(listedPriceExpired(undefined, NOW)).toBe(false);
    expect(listedPriceExpired("not a day", NOW)).toBe(false);
    expect(priceStandingFor({ listed: { priceGbp: 5.9, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(5) } }, NOW).oldListed)
      .toBeUndefined();
  });

  it("refuses a listed price whose source is not a public http(s) URL", () => {
    for (const sourceUrl of ["", "javascript:alert(1)", "file:///menu", "https://user:pw@pub.example/menu"]) {
      const decision = priceStandingFor(
        { listed: { priceGbp: 5.9, sourceUrl, observedAt: daysAgo(1) } },
        NOW,
      );
      expect(decision.standing).not.toBe("listed");
    }
  });

  it("describes listed prices by their source without claiming the venue published them", () => {
    expect(priceStandingNote("listed")).toContain("A public source lists this price");
    expect(priceStandingNote("listed")).not.toContain("The pub or its chain published");
    expect(priceStandingNote("none")).toBe("This record does not support a current confirmed or listed price.");
  });

  it("refuses a future observation rather than treating it as the freshest evidence", () => {
    const decision = priceStandingFor(
      { confirmed: { priceGbp: 5.4, observedAt: daysAgo(-3) } },
      NOW,
    );
    expect(decision.standing).toBe("none");
  });

  it("refuses an estimate that will not name its basis, its sample or its day", () => {
    const complete = { priceGbp: 6, basis: "chain_menu", sampleSize: 9, computedAt: daysAgo(1) };
    expect(priceStandingFor({ estimate: complete }, NOW).standing).toBe("estimate");
    expect(priceStandingFor({ estimate: { ...complete, basis: "  " } }, NOW).standing).toBe("none");
    expect(priceStandingFor({ estimate: { ...complete, sampleSize: 0 } }, NOW).standing).toBe("none");
    expect(priceStandingFor({ estimate: { ...complete, computedAt: "not a date" } }, NOW).standing).toBe("none");
  });

  it("prints an estimate as est. and never as a bare price", () => {
    const estimate = priceStandingFor(
      { estimate: { priceGbp: 5.8, basis: "regional_baseline", sampleSize: 40, computedAt: daysAgo(1) } },
      NOW,
    );
    expect(priceStandingFigure(estimate)).toBe("est. £5.80");

    const listed = priceStandingFor(
      { listed: { priceGbp: 5.8, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(1) } },
      NOW,
    );
    expect(priceStandingFigure(listed)).toBe("£5.80");
  });

  it("answers null rather than an empty string when there is no figure", () => {
    expect(priceStandingFigure(priceStandingFor({}, NOW))).toBeNull();
  });

  it("keeps a modelled price out of every lane that speaks with authority", () => {
    expect(standingCarriesAuthority("confirmed")).toBe(true);
    expect(standingCarriesAuthority("listed")).toBe(true);
    expect(standingCarriesAuthority("estimate")).toBe(false);
    expect(standingCarriesAuthority("none")).toBe(false);
  });
});
