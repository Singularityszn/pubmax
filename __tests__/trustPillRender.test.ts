// What a reader actually sees beside a price.
//
// THE ONE FAILURE THIS FENCE EXISTS FOR: a modelled figure rendering as a plain
// price. So the estimate case is checked on the RENDERED markup rather than on
// the helper, and the bare-figure string is asserted absent.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TrustPill from "@/components/prices/TrustPill";
import { HOW_WE_ESTIMATE_HREF, priceStandingFor } from "@/lib/priceTier";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const render = (decision: Parameters<typeof TrustPill>[0]["decision"], basisNote?: string) =>
  renderToStaticMarkup(createElement(TrustPill, { decision, basisNote }));

const listed = priceStandingFor(
  { listed: { priceGbp: 5.4, sourceUrl: "https://pub.example/menu", observedAt: "2026-08-20T00:00:00.000Z" } },
  NOW,
);
const estimate = priceStandingFor(
  { estimate: { priceGbp: 6.6, basis: "regional_baseline", sampleSize: 120, computedAt: "2026-09-01T00:00:00.000Z" } },
  NOW,
);
const confirmed = priceStandingFor(
  { confirmed: { priceGbp: 5, observedAt: "2026-09-01T00:00:00.000Z" } },
  NOW,
);
const nothing = priceStandingFor({}, NOW);

describe("TrustPill", () => {
  it("prints a published price plainly and does not offer the estimate method", () => {
    const html = render(listed);
    expect(html).toContain("£5.40");
    expect(html).toContain("Listed");
    expect(html).not.toContain("est.");
    expect(html).not.toContain(HOW_WE_ESTIMATE_HREF);
  });

  it("never prints a modelled figure as a bare price, and always offers the method", () => {
    const html = render(estimate);
    expect(html).toContain("est. £6.60");
    expect(html).not.toMatch(/>\s*£6\.60\s*</);
    expect(html).toContain(HOW_WE_ESTIMATE_HREF);
    expect(html).toContain("How we estimate");
  });

  it("names the sample behind an estimate when it is given one", () => {
    expect(render(estimate, "Modelled from 120 published prices (prices nearby).")).toContain(
      "Modelled from 120 published prices",
    );
  });

  it("says there is no price yet rather than rendering nothing", () => {
    const html = render(nothing);
    expect(html).toContain("No price yet");
    expect(html).not.toContain("£");
  });

  it("wears a different tone per standing, so the four never read alike", () => {
    const tones = [confirmed, listed, estimate, nothing].map((decision) => {
      const match = /class="trustPill (trustPill\w+)"/.exec(render(decision));
      return match?.[1];
    });
    expect(tones).toEqual([
      "trustPillConfirmed",
      "trustPillListed",
      "trustPillEstimate",
      "trustPillNone",
    ]);
    expect(new Set(tones).size).toBe(4);
  });
});
