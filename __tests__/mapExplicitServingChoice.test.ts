import { describe, expect, it } from "vitest";

import { mergeCrawlUrlSearch } from "@/components/map/useCrawlUrl";

const landedContext = {
  sel: "venue-1qge8u",
  accept: "1",
  src: "near",
  log: "1",
  contribute: "price",
  plan: "1",
  place: "Hammersmith",
  uk: "1",
  mapNotice: "limited-coverage",
  crawl: "victorian-soho",
};
const landedQuery = new URLSearchParams(landedContext).toString();

describe("explicit serving choice during Map surface history", () => {
  it("keeps All servings after clearing the matching gin subtype's predecessor serving", () => {
    const merged = new URLSearchParams(mergeCrawlUrlSearch(
      "drink=gin&sub=gin-london-dry&q=Albion&band=river-history",
      `?drink=gin&sub=gin-london-dry&serving=25ml&${landedQuery}`,
      true,
      { category: "gin", subtype: "gin-london-dry", serving: null },
    ));

    expect(merged.has("serving")).toBe(false);
    expect(Object.fromEntries(merged)).toEqual({
      drink: "gin",
      sub: "gin-london-dry",
      q: "Albion",
      band: "river-history",
      ...landedContext,
    });
  });

  it("keeps the chosen 250ml wine serving instead of restoring the matching predecessor's 175ml", () => {
    const merged = new URLSearchParams(mergeCrawlUrlSearch(
      "drink=wine&sub=wine-white&q=Sydney&alt=coffee",
      `?drink=wine&sub=wine-white&serving=175ml&${landedQuery}`,
      true,
      { category: "wine", subtype: "wine-white", serving: "250ml" },
    ));

    expect(merged.get("serving")).toBe("250ml");
    expect(Object.fromEntries(merged)).toEqual({
      drink: "wine",
      sub: "wine-white",
      q: "Sydney",
      alt: "coffee",
      serving: "250ml",
      ...landedContext,
    });
  });

  it("ignores another subtype's choice and never carries a different category's old serving forward", () => {
    const encoded = "drink=wine&sub=wine-white&mode=build&pubs=venue-1qge8u,venue-16pnwmm";
    const unrelatedChoice = { category: "wine", subtype: "wine-red", serving: "250ml" } as const;
    const matching = new URLSearchParams(mergeCrawlUrlSearch(
      encoded,
      `?drink=wine&sub=wine-white&serving=175ml&${landedQuery}`,
      true,
      unrelatedChoice,
    ));

    expect(Object.fromEntries(matching)).toEqual({
      drink: "wine",
      sub: "wine-white",
      mode: "build",
      pubs: "venue-1qge8u,venue-16pnwmm",
      serving: "175ml",
      ...landedContext,
    });

    const mismatched = new URLSearchParams(mergeCrawlUrlSearch(
      encoded,
      `?drink=gin&sub=gin-london-dry&serving=25ml&${landedQuery}`,
      true,
      unrelatedChoice,
    ));

    expect(mismatched.has("serving")).toBe(false);
    expect(Object.fromEntries(mismatched)).toEqual({
      drink: "wine",
      sub: "wine-white",
      mode: "build",
      pubs: "venue-1qge8u,venue-16pnwmm",
      ...landedContext,
    });
  });
});
