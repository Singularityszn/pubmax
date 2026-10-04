import { describe, expect, it, vi } from "vitest";
import { createRobotsGate, robotsOutcome, settleReadFailure, webSlice } from "../scripts/lib/webSlice.mjs";

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

  it("keeps a cause-less Extract failure open until the page itself answers 404", async () => {
    const searches = { "search-0": search([{ url: ownSite, title: "Cricketers Arms", content: "OX4 2EZ" }]) };
    const failing = { failed_results: [{ url: ownSite, error: "Failed to fetch url" }], results: [] };
    const open = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches,
      robots: vi.fn(async () => allowed), extract: vi.fn(async () => failing), probe: vi.fn(async () => ({ status: 200, landed: "permitted" })) });
    await expect(webSlice(slice, { spend: true }, open.io)).rejects.toThrow("Failed to fetch url");
    expect(open.stored.has(ownSite)).toBe(false);
    const gone = harness({ state: { queries: [{ query: "q0", resultPath: "search-0", observedAt }] }, searches: { ...searches, "search-1": search([]) },
      robots: vi.fn(async () => allowed), extract: vi.fn(async () => failing), probe: vi.fn(async () => ({ status: 404, landed: "permitted" })), search: vi.fn(async () => search([])) });
    const outcome = await webSlice(slice, { spend: true }, gone.io);
    expect(outcome.complete).toBe(true);
    expect(gone.stored.get(ownSite)).toMatchObject({ unreadable: "page HTTP 404", settled: true });
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
  it("retries an unreachable robots file twice, then skips the host with the evidence of every attempt", async () => {
    const check = vi.fn(async () => unreachable);
    const sleep = vi.fn(async () => {});
    const gate = createRobotsGate(check, { sleep });
    const first = await gate("https://x.example/a");
    expect(first).toMatchObject({ outcome: "skipped", reason: "robots unreachable", attempts: 3 });
    expect(first.evidence).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(await gate("https://x.example/b")).toMatchObject({ outcome: "skipped" });
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("asks again after one transient answer and takes the source's real answer", async () => {
    const check = vi.fn().mockResolvedValueOnce(unreachable).mockResolvedValue({ allowed: true, reason: "allowed" });
    expect(await createRobotsGate(check, { sleep: async () => {} })("https://y.example/a")).toMatchObject({ outcome: "allowed" });
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
