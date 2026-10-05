import { describe, expect, it, vi } from "vitest";
import { runSlice } from "../scripts/discover_parallel_venues.mjs";

const city = (id: string) => ({ id, displayName: id, bbox: [0, 0, 1, 1] });
const slice = (id: string) => ({ city: city(id), district: "X1", category: { id: "pub", label: "pubs" }, districtKnown: [] });
const cachedWeb = { found: [{ name: "Original Swan" }], rejected: [{ name: "x", reason: "unreadable: robots refused" }], researched: 1, taskRuns: 0, webSearches: 2, pagesRead: 3,
  skips: [{ url: "https://www.beerintheevening.com/a", kind: "robots" }], filtered: [{ url: "https://x.gov.uk/a", reason: "public body or academic site" }], complete: true };

// Fake lanes stand in for the Parallel and Tavily lanes; the real lanes and
// their I/O are covered in webSlice.test.ts and by the CLI replay itself.
function lanes(parallelComplete: (spend: boolean) => boolean) {
  return {
    parallel: vi.fn(async (_slice: unknown, _options: Record<string, unknown>, spend: boolean) => ({ found: [], rejected: [], researched: 0, taskRuns: 2, complete: parallelComplete(spend) })),
    web: vi.fn(async () => cachedWeb),
  };
}

describe("runSlice", () => {
  it("replays an unselected city's cached Tavily lane under the default Parallel provider", async () => {
    const fake = lanes((spend) => spend);
    const options = { cities: ["birmingham"], provider: "parallel", refresh: false, processor: "pro", matches: 30 };
    const unselected = await runSlice(slice("oxford"), options, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("oxford"), expect.objectContaining({ refresh: false }), false);
    expect(fake.web).toHaveBeenCalledWith(slice("oxford"), { spend: false, refresh: false, skipsOnly: false });
    expect(unselected).toMatchObject({ complete: true, taskRuns: 2, skips: cachedWeb.skips, filtered: cachedWeb.filtered, found: cachedWeb.found });
    const selected = await runSlice(slice("birmingham"), options, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("birmingham"), expect.objectContaining({ refresh: false }), true);
    expect(selected).toMatchObject({ complete: true });
    expect(fake.web).toHaveBeenCalledTimes(1);
  });

  it("refreshes only the selected city and spends on Tavily only there", async () => {
    const fake = lanes(() => false);
    const options = { cities: ["manchester"], provider: "tavily", refresh: true, processor: "pro", matches: 30 };
    expect(await runSlice(slice("oxford"), options, fake)).toMatchObject({ complete: true, skips: cachedWeb.skips, filtered: cachedWeb.filtered });
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("oxford"), expect.objectContaining({ refresh: false }), false);
    expect(fake.web).toHaveBeenLastCalledWith(slice("oxford"), { spend: false, refresh: false, skipsOnly: false });
    await runSlice(slice("manchester"), options, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("manchester"), expect.objectContaining({ refresh: false }), false);
    expect(fake.web).toHaveBeenLastCalledWith(slice("manchester"), { spend: true, refresh: true, skipsOnly: false });
  });

  it("keeps a selected city's paid Parallel pages under a Tavily refresh and buys no search for a finished slice", async () => {
    const paid = { found: [{ name: "Society Birmingham" }], rejected: [], researched: 9, taskRuns: 4, complete: true };
    const parallel = vi.fn(async (_slice: unknown, options: Record<string, unknown>) => (options.refresh ? { found: [], rejected: [], researched: 0, taskRuns: 0, complete: false } : paid));
    const web = vi.fn(async () => cachedWeb);
    const outcome = await runSlice(slice("birmingham"), { cities: ["birmingham"], provider: "tavily", refresh: true, processor: "pro", matches: 30 }, { parallel, web });
    expect(parallel).toHaveBeenCalledWith(slice("birmingham"), expect.objectContaining({ refresh: false }), false);
    expect(outcome).toBe(paid);
    expect(web).not.toHaveBeenCalled();
  });

  it("refreshes the paid Parallel lane only when it may research again", async () => {
    const fake = lanes(() => true);
    await runSlice(slice("birmingham"), { cities: ["birmingham"], provider: "parallel", refresh: true, processor: "pro", matches: 30 }, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("birmingham"), expect.objectContaining({ refresh: true }), true);
  });

  it("reads only skipped sources under Firecrawl, never refreshing either lane", async () => {
    const fake = lanes(() => false);
    const options = { cities: ["leeds"], provider: "firecrawl", refresh: true, processor: "pro", matches: 30 };
    await runSlice(slice("leeds"), options, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("leeds"), expect.objectContaining({ refresh: false }), false);
    expect(fake.web).toHaveBeenLastCalledWith(slice("leeds"), { spend: true, refresh: false, skipsOnly: true });
    await runSlice(slice("oxford"), options, fake);
    expect(fake.web).toHaveBeenLastCalledWith(slice("oxford"), { spend: false, refresh: false, skipsOnly: true });
  });

  it("replays every city without spending when no city is selected", async () => {
    const fake = lanes(() => false);
    await runSlice(slice("leeds"), { cities: [], provider: "tavily", refresh: true, processor: "pro", matches: 30 }, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("leeds"), expect.objectContaining({ refresh: false }), false);
    expect(fake.web).toHaveBeenLastCalledWith(slice("leeds"), { spend: false, refresh: false, skipsOnly: false });
  });
});

// Each test loads the script afresh, so its run credit count starts at zero.
async function freshScript() {
  vi.resetModules();
  return import("../scripts/discover_parallel_venues.mjs");
}

describe("firecrawlRead", () => {
  const oxford = city("oxford");
  type ScrapeRequest = (provider: string, endpoint: string, options: { city: string; body: { url: string } }) => Promise<{ data: { markdown: string; metadata: Record<string, unknown> } }>;

  it("keeps the run under its credit cap when every concurrent scrape is a PDF billed a credit for the page and one per PDF page", async () => {
    const { firecrawlRead, FIRECRAWL_RUN_CREDITS } = await freshScript();
    const request = vi.fn<ScrapeRequest>(async (_provider, _endpoint, { body }) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { data: { markdown: "# Menu", metadata: { creditsUsed: 6, statusCode: 200, url: body.url } } };
    });
    const reads = await Promise.allSettled(Array.from({ length: 60 }, (_, index) => firecrawlRead(`https://pub${index}.example/menu.pdf`, oxford, request)));
    const used = request.mock.calls.length * 6;
    expect(used).toBeLessThanOrEqual(FIRECRAWL_RUN_CREDITS);
    expect(reads.filter((read) => read.status === "rejected").map((read) => (read as PromiseRejectedResult).reason.message)).toContain(`Firecrawl run cap of ${FIRECRAWL_RUN_CREDITS} credits reached; checkpoint retained, rerun to resume`);
  });

  it("answers under the URL it was asked for and carries a redirect's landing beside it", async () => {
    const { firecrawlRead } = await freshScript();
    const asked = "https://www.crown.example/";
    const landed = "https://crown.example/welcome";
    const request = vi.fn<ScrapeRequest>(async () => ({ data: { markdown: "The Crown, OX4 2EZ", metadata: { creditsUsed: 1, statusCode: 200, url: landed } } }));
    expect(await firecrawlRead(asked, oxford, request)).toEqual({ results: [{ url: asked, landed_url: landed, raw_content: "The Crown, OX4 2EZ" }] });
  });
});
