import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The landing page may not promise per-price DATES (F1).
//
// The counts it renders (`stats.pintPricesObserved`) come from the CURATED
// venue index, whose priced rows carry a SOURCE but no per-row observation
// date - the whole dataset shares one hand-maintained freshness stamp. Only two
// lanes are genuinely dated per row: community submissions (each stamped by the
// server clock at submit time) and the first-party drink_price_updates feed.
//
// So "sourced" is the strong, true claim for the headline numbers, and any
// dating language on the landing page has to be scoped to the people-logged
// lane. This test guards the claim, not the wording: rephrase freely, just
// never let "every price" and "dated" back into the same sentence.

const LANDING = path.join(__dirname, "..", "components", "landing", "LandingPage.tsx");

/** Visible copy only - comments explain the rule and must not trip it. */
function landingCopy(): string {
  return readFileSync(LANDING, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

describe("landing price-provenance copy", () => {
  const copy = landingCopy();

  it("makes no blanket claim that prices are dated", () => {
    for (const untrue of [
      "each dated",
      "dated prices",
      "Every one dated",
      "every price has a date",
      "a source and a date",
      "a source and the date",
    ]) {
      expect(copy.toLowerCase()).not.toContain(untrue.toLowerCase());
    }
  });

  it("still claims provenance, which IS true of every price", () => {
    expect(copy).toContain("each sourced");
    expect(copy).toContain("sourced prices");
  });

  it("scopes what dating language remains to the people-logged lane", () => {
    // The two places the page still talks about a date now name WHO logged the
    // price in the same breath - the only lane where a per-row date exists.
    // (Rewrite the wording as you like; keep the scoping.)
    const flat = copy.replace(/\s+/g, " ");
    expect(flat).toContain("the ones logged by drinkers carry the day they were seen");
    expect(flat).toContain("the ones drinkers log come with the day they were seen");
  });
});
