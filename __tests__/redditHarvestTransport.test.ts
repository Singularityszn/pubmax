import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Plain-node CLI exports are exercised directly.
import { fetchRedditJson, redditJsonUrl } from "../scripts/harvest_reddit_london_prices.mjs";

const url = "https://www.reddit.com/r/london/comments/1abc234/pints/";
const allowed = async () => ({ allowed: true, reason: "allowed", evidence: "test" });

describe("Reddit harvest transport", () => {
  it("keeps listing query parameters outside the JSON pathname", () => {
    const listing = "https://www.reddit.com/r/london/search.json?q=pint&limit=25";
    expect(redditJsonUrl(listing)).toBe(listing);
  });
  it("refuses foreign discovery URLs before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchRedditJson("https://example.com/r/london", { fetchImpl, wait: async () => {} })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not fetch a page refused by robots", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchRedditJson(url, { fetchImpl, wait: async () => {}, robotsChecker: async () => ({ allowed: false }) })).rejects.toThrow(/robots/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses a redirect before contacting its destination", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.com/" } }));
    await expect(fetchRedditJson(url, { fetchImpl, wait: async () => {}, robotsChecker: allowed })).rejects.toThrow(/redirect/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("reads bounded JSON after permission passes", async () => {
    const fetchImpl = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
    await expect(fetchRedditJson(url, { fetchImpl, wait: async () => {}, robotsChecker: allowed })).resolves.toEqual([]);
  });
});
