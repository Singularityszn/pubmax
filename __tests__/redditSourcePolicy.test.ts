import { describe, expect, it, vi } from "vitest";
import { harvestSourcesOfKind, isHarvestableRedditUrl } from "@/lib/harvest/sourcePolicy";
// @ts-expect-error Plain-node CLI exports are exercised directly.
import { fetchRedditJson } from "../scripts/harvest_reddit_london_prices.mjs";

describe("Reddit source admission", () => {
  it("records every configured listing's observed refusal in the shared registry", () => {
    const sources = harvestSourcesOfKind("community-price-observations");
    expect(sources).toHaveLength(3);
    for (const source of sources) {
      expect(source.firstParty).toBe(false);
      expect(source.nonFirstPartyException).toContain("community");
      expect(source.access).toMatchObject({ allowed: false, reason: "robots-disallowed" });
      expect(isHarvestableRedditUrl(source.url)).toBe(false);
    }
  });

  it("does not let an injected robots allowance override the registry refusal", async () => {
    const fetchImpl = vi.fn();
    const robotsChecker = vi.fn(async () => ({ allowed: true }));
    await expect(fetchRedditJson("https://www.reddit.com/r/london/comments/1abc234/pints/", {
      fetchImpl, robotsChecker, wait: async () => {},
    })).rejects.toThrow(/policy refused/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(robotsChecker).not.toHaveBeenCalled();
  });
});
