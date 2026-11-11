import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSocialAlternatives } from "@/lib/socialAlternatives.server";
import { resetUkPriceBundleForTests } from "@/lib/ukPriceBundle.server";

afterEach(() => {
  vi.restoreAllMocks();
  resetUkPriceBundleForTests();
});

describe("Social alternatives from committed public packs", () => {
  it("offers the newest London pint menu fact and leaves Silver Fox's newer wine out", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-03T12:00:00Z"));
    const answer = await loadSocialAlternatives();
    expect(answer.priceRead).toBe("ready");
    expect(answer.prices.map((price) => price.venueId)).not.toContain("venue-uk-w770044829");
    expect(answer.prices).toContainEqual({
      venueId: "venue-uk-n1707216586", name: "The Thirsty Bear", href: "/map?sel=venue-uk-n1707216586",
      drink: "Inches Cider", serving: "pint", priceGbp: 5.95,
      publisher: { label: "thethirstybear.com", url: "https://www.thethirstybear.com/drinks" },
      observedOn: "2026-10-09",
    });
  });

  it("withholds the latest-price claim when the UK bundle cannot be read", async () => {
    const read = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).endsWith("/uk_prices/rows.json")) throw new Error("unavailable");
      return read(...args);
    });
    expect(await loadSocialAlternatives()).toMatchObject({ priceRead: "unavailable", prices: [] });
  });
});
