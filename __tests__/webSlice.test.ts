import { describe, expect, it, vi } from "vitest";
import { createRobotsGate, robotsOutcome, settleReadFailure, webSlice } from "../scripts/lib/webSlice.mjs";
import { defined } from "@/__tests__/helpers/defined";

const oxford = { id: "oxford", displayName: "Oxford", bbox: [51.72, -1.3, 51.8, -1.2] as [number, number, number, number] };
const slice = { city: oxford, district: "OX4", category: { id: "pub", label: "pubs" } };
const listing = "https://camra.org.uk/pubs/place/cowley";
const ownSite = "https://www.cricketersarmsoxford.example/";
const listingText = ["Original Swan", "Pub, in Oxford", "Cask Ale", "188 Oxford Road, Cowley, Oxford, OX4 2LF"].join("\n");
const ownText = "**Cricketers Arms**\n\n102 Temple Cowley Road\n\nOxford\n\nOX4 2EZ\n\nA proper pub with real ales.";
const observedAt = "2026-10-04T10:00:00.000Z";
const allowed = { outcome: "allowed", reason: "allowed", checkedAt: observedAt };

function search(results: Array<Record<string, unknown>>) {
  return { results };
}

// A slice's stored state and the fake I/O around it. Every paid or network
// method throws unless a test hands it an implementation.
type Overrides = Partial<Record<"robots" | "search" | "extract" | "probe", ReturnType<typeof vi.fn>>>;

function harness({ state = null, searches = {}, pages = {}, ...overrides }: { state?: Record<string, unknown> | null; searches?: Record<string, unknown>; pages?: Record<string, unknown> } & Overrides = {}) {
  const stored = new Map(Object.entries(pages));
  const forbidden = (name: string) => vi.fn(async () => { throw new Error(`${name} must not be called`); });
  const io = {
    now: () => observedAt,
    loadState: vi.fn(async () => (state ? structuredClone(state) : null)),
    saveState: vi.fn(async () => {}),
    search: forbidden("search"),
    saveSearch: vi.fn(async (index: number) => `search-${index}`),
    readSearch: vi.fn(async (resultPath: string) => searches[resultPath]),
    robots: forbidden("robots"),
    storedPage: vi.fn(async (url: string) => stored.get(url) ?? null),
    storePage: vi.fn(async (url: string, page: unknown) => { stored.set(url, page); }),
    extract: forbidden("extract"),
    probe: forbidden("probe"),
    geocode: vi.fn(async (candidate: Record<string, unknown>) => ({ ...candidate, lat: 51.74, lng: -1.21, coordinatePrecision: "postcode-centroid" })),
    ...overrides,
  };
  return { io, stored };
}

const cachedState = {
  queries: [
    { query: "q0", resultPath: "search-0", observedAt },
    { query: "q1", resultPath: "search-1", observedAt },
  ],
  robots: { [listing]: allowed, [ownSite]: allowed },
};
const cachedSearches = {
  "search-0": search([{ url: listing, title: "Pubs in Cowley", content: "OX4 2LF", raw_content: listingText }]),
  "search-1": search([{ url: listing, content: "OX4 2LF" }]),
};

describe("Tavily web slice", () => {
  it("replays an unselected city's cached slice to completion without a single call", async () => {
    const { io } = harness({ state: cachedState, searches: cachedSearches });
    const outcome = await webSlice(slice, { spend: false }, io);
    expect(outcome.complete).toBe(true);
    expect(outcome.researched).toBe(1);
    expect(outcome.found.map((row: { name: string }) => row.name)).toEqual(["Original Swan"]);
    for (const name of ["search", "robots", "extract", "probe"] as const) expect(io[name]).not.toHaveBeenCalled();
    expect(io.saveState).not.toHaveBeenCalled();
  });

  it("stays incomplete without spending when a page was never read or robots never asked", async () => {
    const unread = harness({ state: cachedState, searches: { ...cachedSearches, "search-0": search([{ url: ownSite, title: "Cricketers Arms", content: "OX4 2EZ" }]) } });
    await expect(webSlice(slice, { spend: false }, unread.io)).rejects.toMatchObject({ partial: { complete: false } });
    const unasked = harness({ state: { ...cachedState, robots: {} }, searches: cachedSearches });
    await expect(webSlice(slice, { spend: false }, unasked.io)).rejects.toThrow("robots not yet asked");
    for (const io of [unread.io, unasked.io]) for (const name of ["search", "robots", "extract", "probe"] as const) expect(io[name]).not.toHaveBeenCalled();
  });

  it("completes with a recorded skip when a source's robots stays unreachable, reading nothing from it", async () => {
    const skip = { outcome: "skipped", reason: "robots unreachable", attempts: 3, evidence: [{ at: observedAt, reason: "robots-unreachable", evidence: "fetch failed" }] };
    const { io } = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches: { "search-0": search([{ url: listing, raw_content: listingText, content: "OX4 2LF" }]), "search-1": search([]) },
      robots: vi.fn(async () => skip), search: vi.fn(async () => search([])) });
    const outcome = await webSlice(slice, { spend: true }, io);
    expect(outcome.complete).toBe(true);
    expect(outcome.found).toEqual([]);
    expect(outcome.skips).toMatchObject([{ url: listing, host: "camra.org.uk", reason: "robots unreachable", attempts: 3 }]);
    const replay = await webSlice(slice, { spend: false }, harness({ state: (io.saveState.mock.calls.at(-1) as unknown[])[0] as Record<string, unknown>, searches: { "search-0": search([{ url: listing, raw_content: listingText, content: "OX4 2LF" }]), "search-1": search([]) } }).io);
    expect(replay).toMatchObject({ complete: true, skips: [{ url: listing, reason: "robots unreachable" }] });
  });

  it("skips a page Extract cannot read at basic or advanced depth, with both errors and the page's status, unless the page is gone", async () => {
    const searches = { "search-0": search([{ url: ownSite, title: "Cricketers Arms", content: "OX4 2EZ" }]), "search-1": search([]) };
    const extract = vi.fn(async (urls: string[], depth: string) => ({ results: [], failed_results: urls.map((url) => ({ url, error: depth === "basic" ? "Failed to fetch url" : "Error fetching content" })) }));
    const reachable = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches,
      robots: vi.fn(async () => allowed), extract, probe: vi.fn(async () => ({ status: 200, landed: "permitted" })), search: vi.fn(async () => search([])) });
    const outcome = await webSlice(slice, { spend: true }, reachable.io);
    expect(outcome.complete).toBe(true);
    expect(outcome.found).toEqual([]);
    expect(outcome.skips).toMatchObject([{ url: ownSite, kind: "extract", attempts: 2, reason: "Tavily Extract failed at basic and advanced depth; the page answered HTTP 200",
      evidence: { basic: "Failed to fetch url", advanced: "Error fetching content", probe: { status: 200 } } }]);
    const replay = await webSlice(slice, { spend: false }, harness({ state: (reachable.io.saveState.mock.calls.at(-1) as unknown[])[0] as Record<string, unknown>, searches, pages: Object.fromEntries(reachable.stored) }).io);
    expect(replay).toMatchObject({ complete: true, skips: [{ url: ownSite, kind: "extract" }] });
    const gone = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches,
      robots: vi.fn(async () => allowed), extract, probe: vi.fn(async () => ({ status: 404, landed: "permitted" })), search: vi.fn(async () => search([])) });
    const settledOutcome = await webSlice(slice, { spend: true }, gone.io);
    expect(settledOutcome).toMatchObject({ complete: true, skips: [] });
    expect(gone.stored.get(ownSite)).toMatchObject({ unreadable: "page HTTP 404", settled: true });
  });

  it("reads again through the Firecrawl reader only the sources an earlier run skipped, never searching", async () => {
    const robotsSkip = { outcome: "skipped", reason: "robots unreachable", attempts: 3, evidence: [], checkedAt: observedAt };
    const extractSkip = { outcome: "skipped", kind: "extract", reason: "Tavily Extract failed at basic and advanced depth; the page answered HTTP 200", attempts: 2, evidence: {}, checkedAt: observedAt };
    const reread = "https://www.reread.example/";
    const state = { queries: [{ query: "q0", resultPath: "search-0", observedAt }, { query: "q1", resultPath: "search-1", observedAt }], robots: { [listing]: robotsSkip, [ownSite]: allowed, [reread]: allowed } };
    const searches = { "search-0": search([{ url: listing, content: "OX4 2LF" }, { url: ownSite, title: "Cricketers Arms", content: "OX4 2EZ" }, { url: reread, title: "Reread", content: "OX4 1AA" }]), "search-1": search([]) };
    const pages = { [ownSite]: { url: ownSite, skip: extractSkip }, [reread]: { url: reread, landedUrl: reread, observedAt, title: null, text: "" } };
    const reader = { provider: "firecrawl", label: "Firecrawl scrape", failed: "failed", depths: ["basic"] };
    const extract = vi.fn(async (urls: string[]) => ({ results: urls.map((url) => ({ url, raw_content: url === listing ? listingText : ownText })) }));
    const robots = vi.fn<(url: string) => Promise<typeof allowed>>(async () => allowed);
    const { io, stored } = harness({ state, searches, pages, robots, extract });
    const outcome = await webSlice(slice, { spend: true, skipsOnly: true }, { ...io, reader });
    expect(robots.mock.calls.map(([url]) => url)).toEqual([listing]);
    expect(extract.mock.calls).toEqual([[[listing, ownSite], "basic"]]);
    expect(io.search).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ complete: true, skips: [] });
    expect(outcome.found.map((row) => [row.name, row.provider])).toEqual([["Original Swan", "tavily-firecrawl"], ["Cricketers Arms", "tavily-firecrawl"]]);
    expect(stored.get(ownSite)).toMatchObject({ reader: "firecrawl", text: ownText });
    const unsearched = harness({ state: { queries: [] }, searches, robots, extract });
    expect(await webSlice(slice, { spend: true, skipsOnly: true }, { ...unsearched.io, reader })).toMatchObject({ complete: false });
    expect(unsearched.io.search).not.toHaveBeenCalled();
  });

  it("records a Firecrawl skip with its one read and the page's status", async () => {
    const reader = { provider: "firecrawl", label: "Firecrawl scrape", failed: "failed", depths: ["basic"] };
    const searches = { "search-0": search([{ url: ownSite, title: "Cricketers Arms", content: "OX4 2EZ" }]) };
    const extract = vi.fn(async (urls: string[]) => ({ failed_results: urls.map((url) => ({ url, error: "Firecrawl returned no markdown" })) }));
    const { io } = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }, { query: "q1", resultPath: "search-1", observedAt }], robots: { [ownSite]: allowed } }, searches: { ...searches, "search-1": search([]) },
      pages: { [ownSite]: { url: ownSite, skip: { outcome: "skipped", kind: "extract" } } }, extract, probe: vi.fn(async () => ({ status: 200, landed: "permitted" })) });
    const outcome = await webSlice(slice, { spend: true, skipsOnly: true }, { ...io, reader });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(outcome.skips).toMatchObject([{ url: ownSite, kind: "extract", attempts: 1, reason: "Firecrawl scrape failed; the page answered HTTP 200", evidence: { basic: "Firecrawl returned no markdown", probe: { status: 200 } } }]);
  });

  it("filters pages from sites that cannot describe a venue before reading or paying for them", async () => {
    const council = "https://democracy.manchester.gov.uk/documents/s1/licence.pdf";
    const postcodes = "https://www.postcodearea.co.uk/postaltowns/oxford/ox42lf";
    const searches = { "search-0": search([
      { url: council, content: "Licence for 188 Oxford Road OX4 2LF" }, { url: postcodes, content: "OX4 2LF" },
      { url: listing, title: "Pubs in Cowley", content: "OX4 2LF", raw_content: listingText },
    ]), "search-1": search([]) };
    const robots = vi.fn<(url: string) => Promise<typeof allowed>>(async () => allowed);
    const { io } = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches, robots, search: vi.fn(async () => search([])) });
    const outcome = await webSlice(slice, { spend: true }, io);
    expect(outcome.complete).toBe(true);
    expect(outcome.filtered).toEqual([
      { url: council, host: "democracy.manchester.gov.uk", reason: "public body or academic site" },
      { url: postcodes, host: "www.postcodearea.co.uk", reason: "postcode or property lookup" },
    ]);
    expect(robots.mock.calls.map((call) => call[0])).toEqual([listing]);
    expect(outcome.found.map((row: { name: string }) => row.name)).toEqual(["Original Swan"]);
  });

  it("asks Extract once more at advanced depth before probing a cause-less failure", async () => {
    const searches = { "search-0": search([{ url: ownSite, title: "Cricketers Arms", content: "OX4 2EZ" }]), "search-1": search([]) };
    const extract = vi.fn(async (urls: string[], depth: string) => depth === "basic"
      ? { results: [], failed_results: urls.map((url) => ({ url, error: "Failed to fetch url" })) }
      : { results: [{ url: ownSite, raw_content: ownText }], failed_results: [] });
    const { io } = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches,
      robots: vi.fn(async () => allowed), extract, search: vi.fn(async () => search([])) });
    const outcome = await webSlice(slice, { spend: true }, io);
    expect(extract.mock.calls.map((call) => call[1])).toEqual(["basic", "advanced"]);
    expect(io.probe).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ complete: true, found: [{ name: "Cricketers Arms" }] });
  });

  it("reads again a page an earlier run stored as unreadable without evidence, and honours --refresh", async () => {
    const searches = { "search-0": search([{ url: ownSite, title: "Cricketers Arms", content: "OX4 2EZ" }]), "search-1": search([]) };
    const extract = vi.fn(async () => ({ results: [{ url: ownSite, raw_content: ownText }], failed_results: [] }));
    const { io } = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches, pages: { [ownSite]: { url: ownSite, unreadable: "extract: Failed to fetch url" } },
      robots: vi.fn(async () => allowed), extract, search: vi.fn(async () => search([])) });
    const outcome = await webSlice(slice, { spend: true }, io);
    expect(extract).toHaveBeenCalledWith([ownSite], "basic");
    expect(outcome.found.map((row: { name: string }) => row.name)).toEqual(["Cricketers Arms"]);
    const refreshed = harness({ state: cachedState, searches: { "search-0": search([]) }, search: vi.fn(async () => search([])) });
    await webSlice(slice, { spend: true, refresh: true }, refreshed.io);
    expect(refreshed.io.loadState).not.toHaveBeenCalled();
    expect(refreshed.io.search).toHaveBeenCalledTimes(1);
  });
});

describe("robots gate", () => {
  const unreachable = { allowed: false, reason: "robots-unreachable", evidence: "https://x.example/robots.txt could not be fetched (fetch failed)." };
  // Like lib/harvest/robots.ts: each checker fetches a host's robots once and
  // keeps that answer, transient or not, for every later path on the host.
  function cachingChecker(answers: Array<(path: string) => { allowed: boolean; reason: string; evidence?: string }>) {
    let made = 0;
    const fetched: string[] = [];
    const make = () => {
      const answer = answers[Math.min(made, answers.length - 1)];
      made += 1;
      const cache = new Map<string, boolean>();
      return vi.fn(async (url: string) => {
        const { origin, pathname } = new URL(url);
        if (!cache.has(origin)) { cache.set(origin, true); fetched.push(origin); }
        return defined(answer)(pathname);
      });
    };
    return { make, fetched, made: () => made };
  }

  it("retries an unreachable robots file twice with fresh checkers, then skips the host with the evidence of every attempt", async () => {
    const checkers = cachingChecker([() => unreachable]);
    const sleep = vi.fn(async () => {});
    const gate = createRobotsGate(checkers.make, { sleep });
    const first = await gate("https://x.example/a");
    expect(first).toMatchObject({ outcome: "skipped", kind: "robots", reason: "robots unreachable", attempts: 3 });
    expect(first.evidence).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(await gate("https://x.example/b")).toMatchObject({ outcome: "skipped", attempts: 3 });
    expect(checkers.made()).toBe(3);
  });

  it("keeps the checker that reached a recovered host and judges each later path on its rules", async () => {
    const rules = (path: string) => (path.startsWith("/private") ? { allowed: false, reason: "robots-disallowed", evidence: "Disallow: /private" } : { allowed: true, reason: "allowed" });
    const checkers = cachingChecker([() => unreachable, rules]);
    const gate = createRobotsGate(checkers.make, { sleep: async () => {} });
    expect(await gate("https://y.example/menu")).toMatchObject({ outcome: "allowed" });
    expect(await gate("https://y.example/private/rooms")).toMatchObject({ outcome: "refused", reason: "robots-disallowed" });
    expect(await gate("https://y.example/bar")).toMatchObject({ outcome: "allowed" });
    expect(checkers.made()).toBe(2);
    expect(checkers.fetched).toEqual(["https://y.example", "https://y.example"]);
  });

  it.each([
    [{ allowed: false, reason: "robots-unreadable", evidence: "https://x.example/robots.txt answered 503, so no permission can be read." }, "transient"],
    [{ allowed: false, reason: "robots-unreadable", evidence: "https://x.example/robots.txt answered 429, so no permission can be read." }, "transient"],
    [{ allowed: false, reason: "robots-unreadable", evidence: "https://x.example/robots.txt answered 403, so no permission can be read." }, "refused"],
    [{ allowed: false, reason: "robots-disallowed", evidence: "Disallow: /" }, "refused"],
    [{ allowed: true, reason: "no-rules-published", evidence: "https://x.example/robots.txt returns 404" }, "allowed"],
  ])("never overrides robots: %j is %s", (decision, outcome) => {
    expect(robotsOutcome(decision).outcome).toBe(outcome);
  });
});

describe("Extract failure settling", () => {
  it.each([
    [{ error: "Failed to fetch url" }, { status: 200, landed: "permitted" }, null],
    [{ error: "Failed to fetch url" }, null, null],
    [{ error: "Error fetching content" }, { status: 503, landed: "permitted" }, null],
    [{ error: "Failed to fetch url" }, { status: 410, landed: "permitted" }, "page HTTP 410"],
    [{ error: "Failed to fetch url" }, { status: 403, landed: "permitted" }, "source refused HTTP 403"],
    [{ error: "Failed to fetch url" }, { status: 200, landed: "refused" }, "landed outside the source fence"],
    [{ status: 404 }, null, "extract: 404"],
  ])("settles %j with probe %j as %s", (failure, probe, reason) => {
    expect(settleReadFailure(failure, probe)).toBe(reason);
  });
});
