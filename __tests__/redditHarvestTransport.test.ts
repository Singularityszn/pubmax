import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Plain-node CLI exports are exercised directly.
import { fetchRedditJson, redditJsonUrl } from "../scripts/harvest_reddit_london_prices.mjs";

// Transport behavior after admission uses a mocked policy. The real registry's
// current refusal is covered independently in redditSourcePolicy.test.ts.
vi.mock("@/lib/harvest/sourcePolicy", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/harvest/sourcePolicy")>(),
  isHarvestableRedditUrl: (value: unknown) => typeof value === "string" &&
    /^https:\/\/www\.reddit\.com\/r\/london\/(?:search\.json\?|comments\/1abc234\/pints)/.test(value),
}));

const robotsFactoryCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/harvest/robots.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/harvest/robots")>(),
  fetchHarvestResponse: vi.fn(),
  createRobotsChecker: vi.fn((...args: unknown[]) => {
    robotsFactoryCalls.push(args);
    return async () => ({ allowed: true, reason: "allowed", evidence: "fixture" });
  }),
}));
import { fetchHarvestResponse } from "@/lib/harvest/robots";

const url = "https://www.reddit.com/r/london/comments/1abc234/pints/";
const allowed = async () => ({ allowed: true, reason: "allowed", evidence: "test" });

describe("Reddit harvest transport", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("uses guarded source and robots defaults after source admission", async () => {
    const rawFetch = vi.fn();
    vi.stubGlobal("fetch", rawFetch);
    vi.mocked(fetchHarvestResponse).mockResolvedValueOnce(new Response("[]", { headers: { "content-type": "application/json" } }));
    await expect(fetchRedditJson(url, { wait: async () => {} })).resolves.toEqual([]);
    expect(fetchHarvestResponse).toHaveBeenCalledWith(`${url.slice(0, -1)}.json`, expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }));
    expect(robotsFactoryCalls).toContainEqual([]);
    expect(rawFetch).not.toHaveBeenCalled();
  });
  it("refuses decoded JSON over the two MiB limit", async () => {
    const fetchImpl = vi.fn(async () => new Response(" ".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }));
    await expect(fetchRedditJson(url, { fetchImpl, wait: async () => {}, robotsChecker: allowed })).rejects.toThrow(/limit/);
  });
  it("aborts a stalled body after twenty seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }));
    const result = expect(fetchRedditJson(url, { fetchImpl, wait: async () => {}, robotsChecker: allowed })).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(20_001);
    await result;
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
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
