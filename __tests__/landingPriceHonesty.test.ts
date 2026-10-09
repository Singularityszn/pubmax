import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import LandingFaq from "@/components/landing/LandingFaq";

// The landing may only claim what the price data supports. Every price row
// in the curated index carries the same collection stamp; a named publisher
// appears only when the row names one; only the drinker-logged lane carries
// a per-row day. So the copy never says "every price is dated" and never
// invents a source. The disclosure sentence lives in the footer, once.

const landingSource = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);
const cardSource = readFileSync(
  join(process.cwd(), "components/landing/LandingHero.tsx"),
  "utf8",
);
const faqText = renderToStaticMarkup(createElement(LandingFaq))
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'");

// Comment lines are not copy; strip them so a note about a banned phrase is
// not read as the phrase. JSX text wraps across source lines, so whitespace
// is collapsed before a sentence is looked for.
const copy = landingSource
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
  .join("\n")
  .replace(/\s+/g, " ");
const lower = copy.toLowerCase();
// The words a reader sees: JSX text between tags, plus the string props the
// page prints. Code (`!==`, `!stats`) is not copy.
const visible = [...copy.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).join(" ");

describe("landing price honesty", () => {
  it("never says every price is dated or sourced", () => {
    for (const banned of [
      "each dated",
      "dated prices",
      "every one dated",
      "every price has a date",
      "a source and a date",
      "a source and the date",
      "every price names where it came from",
      "each sourced",
      "sourced prices",
    ]) {
      expect(lower, banned).not.toContain(banned);
    }
  });

  it("carries the disclosure sentence once, in the footer", () => {
    expect(copy).toContain("When a price record names a publisher, we name and link it.");
    expect(copy).toContain("When no publisher is recorded, the price says so.");
    expect(lower).toContain("the ones drinkers log come with the day they were seen");
    expect(copy.match(/we name and link it/g)).toHaveLength(1);
  });

  it("keeps the saving beat as one column of plain words", () => {
    // One measured savings line under the answer cards; no second hero claim.
    expect(copy).toContain('aria-label="What it saves you"');
    expect(copy).not.toContain("The cheapest listed pint near you, on one map.");
    const worth = copy.match(/aria-label="What it saves you"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(worth).toContain("Open the map");
    expect(worth).not.toContain("data-primary-action");
    expect(worth).not.toMatch(/href="\/plan"/);
    // The gap sentence moved to the questions, and it is still said once.
    expect(faqText).toContain("We'd rather leave a gap than invent a figure.");
    expect(faqText.match(/We'd rather leave a gap than invent a figure\./g)).toHaveLength(1);
  });

  it("stays out of the marketing register", () => {
    expect(visible.toLowerCase()).not.toMatch(/\b(journey|unlock|seamless|curated|elevate|empower|discover)\b/u);
    expect(visible).not.toContain("!");
    expect(visible.toLowerCase()).not.toMatch(/thousands of|discord|co-founder/u);
  });

  it("prints the pub card from data alone and names the publisher only when the row does", () => {
    expect(cardSource).not.toMatch(/£\d/);
    expect(cardSource).toContain("No publisher recorded");
    expect(cardSource).toMatch(/Listed by/);
    // A near-you answer reads the slim index's listed cheapest figure, the
    // same one /near prints; the slim index's build-time `priceBand` field and
    // a demo seed may never reach the card. The colour the card paints is
    // lib/priceBand.ts's own call over the listed figure, which is the law.
    expect(cardSource).not.toMatch(/\.priceBand\b|latestDemoPrice|data-band/);
    expect(cardSource).toMatch(/priceBand\(answer\.priceGbp/);
  });
});
