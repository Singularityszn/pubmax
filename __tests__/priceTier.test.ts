import { describe, expect, it } from "vitest";

import {
  CONFIRMED_MAX_AGE_DAYS,
  LISTED_MAX_AGE_DAYS,
  PRICE_STANDINGS,
  PRICE_STANDING_TONE,
  priceStandingFigure,
  priceStandingFor,
  priceStandingLabel,
  priceStandingNote,
  standingCarriesAuthority,
} from "@/lib/priceTier";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe("price standings", () => {
  it("names four standings and gives every one a tone, a label and a note", () => {
    expect(PRICE_STANDINGS).toEqual(["confirmed", "listed", "estimate", "none"]);
    for (const standing of PRICE_STANDINGS) {
      expect(PRICE_STANDING_TONE[standing]).toBeTruthy();
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
    const decision = priceStandingFor(
      { listed: { priceGbp: 5.9, sourceUrl: "https://pub.example/menu", observedAt: daysAgo(LISTED_MAX_AGE_DAYS + 1) } },
      NOW,
    );
    expect(decision.standing).toBe("none");
    expect(decision.reason).toBe("listed_expired");
    expect(decision.priceGbp).toBeNull();
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
