import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSocialAlternatives } from "@/lib/socialAlternatives.server";
import { resetUkPriceBundleForTests } from "@/lib/ukPriceBundle.server";

afterEach(() => {
  vi.restoreAllMocks();
  resetUkPriceBundleForTests();
});

describe("Social alternatives from committed public packs", () => {
  it("includes Silver Fox's 19 October menu fact beyond the legacy price pack", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-03T12:00:00Z"));
    const answer = await loadSocialAlternatives();
    expect(answer.priceRead).toBe("ready");
    expect(answer.prices).toContainEqual({
      venueId: "venue-uk-w770044829", name: "Silver Fox", href: "/map?sel=venue-uk-w770044829",
      drink: "HIDDEN ROAD, MERLOT 13% Spanish medium bodied", serving: "187ml", priceGbp: 6,
      publisher: { label: "silverfoxmicropub.com", url: "https://www.silverfoxmicropub.com/drinks" },
      observedOn: "2026-10-19",
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
