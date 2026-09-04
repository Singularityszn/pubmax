import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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

  it("keeps the why beat as one column of plain words", () => {
    expect(copy.match(/id="why"/g)).toHaveLength(1);
    expect(copy).toContain("Built for the bit before you set off.");
    expect(copy).toContain("Coffee and a quiet Spoons when the afternoon is the outing.");
    expect(copy).toContain("Food before the last train.");
    expect(copy).toContain("Soft drink or alcohol-free with mates who are not drinking.");
    expect(copy).toContain("We would rather leave a gap than invent a figure.");
    const why = copy.match(/id="why"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(why).toContain("Open the map");
    expect(why).not.toContain("data-primary-action");
    expect(why).not.toMatch(/href="\/plan"/);
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
    // same one /near prints; a band or a demo seed may never reach the card.
    expect(cardSource).not.toMatch(/priceBand|latestDemoPrice|data-band/);
  });
});
