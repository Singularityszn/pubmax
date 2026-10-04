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
    expect(fake.web).toHaveBeenCalledWith(slice("oxford"), { spend: false, refresh: false });
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
    expect(fake.web).toHaveBeenLastCalledWith(slice("oxford"), { spend: false, refresh: false });
    await runSlice(slice("manchester"), options, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("manchester"), expect.objectContaining({ refresh: true }), false);
    expect(fake.web).toHaveBeenLastCalledWith(slice("manchester"), { spend: true, refresh: true });
  });

  it("replays every city without spending when no city is selected", async () => {
    const fake = lanes(() => false);
    await runSlice(slice("leeds"), { cities: [], provider: "tavily", refresh: true, processor: "pro", matches: 30 }, fake);
    expect(fake.parallel).toHaveBeenLastCalledWith(slice("leeds"), expect.objectContaining({ refresh: false }), false);
    expect(fake.web).toHaveBeenLastCalledWith(slice("leeds"), { spend: false, refresh: false });
  });
});
