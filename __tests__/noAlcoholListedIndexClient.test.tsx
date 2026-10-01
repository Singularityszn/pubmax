// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import { readListedDrinkIndex, trustedNoAlcoholLensPrices, type MapLensPrice } from "@/lib/mapExperienceLens";

const now = Date.parse("2026-10-01T12:00:00Z");
const soft = { venueId: "venue-13xdb1p", source: "listed", category: "soft-drink", priceGbp: 4.35,
  servingSize: null, sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/",
  observedAt: "2026-09-21T18:27:31.674Z", drinkLabel: null };
const alcoholFree = { ...soft, category: "alcohol-free", priceGbp: 4.95,
  servingSize: "330ml", drinkLabel: "Corona Cero 0.0% 330ml" };
const published = () => [
  ...readListedDrinkIndex([alcoholFree, soft], "alcohol-free"),
  ...readListedDrinkIndex([alcoholFree, soft], "soft-drink"),
];

// Exercise the existing policy entry point. The optional publisher argument
// is ignored by the baseline, so failure is the missing quote, not an import.
const discover = trustedNoAlcoholLensPrices as (
  rows: ReadonlyMap<string, readonly CommunityPrice[]>, clock: number,
  listed: readonly MapLensPrice[],
) => Map<string, MapLensPrice>;
type State = ReturnType<typeof useCommunityPrices> & {
  listedNoAlcoholPrices?: readonly MapLensPrice[];
};
let current: State;
let root: Root | null = null;
let container: HTMLDivElement;
function Surface() {
  current = useCommunityPrices();
  return createElement("button", { onClick: current.loadNoAlcoholIndex }, "Read no-alcohol prices");
}
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(Surface)); });
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("no-alcohol discovery preserves publisher authority", () => {
  it("returns the owned soft quote with unknown serving, never the other AF row's 330ml", () => {
    expect(discover(new Map(), now, published()).get(soft.venueId)).toMatchObject({
      category: "soft-drink", categoryLabel: "Soft drinks", source: "listed", priceGbp: 4.35,
      servingSize: null, sourceUrl: soft.sourceUrl, observedAt: soft.observedAt,
    });
  });

  it("keeps current corroborated community authority ahead of cheaper listed quotes", () => {
    const community: CommunityPrice = { venueId: soft.venueId, drinkCategory: "alcohol-free",
      priceGbp: 6, submittedAt: now, source: "community", corroborations: 2 };
    expect(discover(new Map([[soft.venueId, [community]]]), now, published()).get(soft.venueId))
      .toMatchObject({ source: "community", category: "alcohol-free", priceGbp: 6 });
    expect(discover(new Map([[soft.venueId, [{ ...community, corroborations: 1 }]]]), now, published())
      .get(soft.venueId)).toMatchObject({ source: "listed", priceGbp: 4.35 });
  });

  it("does not turn expired, unsafe or alcoholic quotes into no-alcohol authority", () => {
    const invalid: MapLensPrice[] = [
      { ...published()[1], observedAt: "2020-01-01T00:00:00Z" },
      { ...published()[1], sourceUrl: "javascript:alert(1)" },
      { ...published()[1], category: "beer", priceGbp: 6.1 },
    ];
    expect(discover(new Map(), now, invalid).size).toBe(0);
  });

  it("reads a selected category independently after a partial combined no-alcohol read", async () => {
    let finishCategory!: (response: Response) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("lens=no-alcohol")) {
        return Promise.resolve(Response.json({ prices: [], listedPrices: [soft], truncated: true }));
      }
      return new Promise<Response>((resolve) => { finishCategory = resolve; });
    });
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { container.querySelector("button")!.click(); });
    expect(current.noAlcoholIndexStatus).toBe("partial");
    await act(async () => { current.loadDrinkCategoryIndex("soft-drink"); });
    expect(current.drinkCategoryIndexStatus.get("soft-drink")).toBe("loading");
    expect(String(fetcher.mock.calls[1][0])).toBe("/api/price-submit?drinkCategory=soft-drink");
    await act(async () => { finishCategory(Response.json({ prices: [], listedPrices: [soft], truncated: false })); });
    expect(current.drinkCategoryIndexStatus.get("soft-drink")).toBe("ready");
    expect(current.listedDrinkPrices.get("soft-drink")).toEqual(readListedDrinkIndex([soft], "soft-drink"));
    expect(current.noAlcoholIndexStatus).toBe("partial");
  });

  it("retries an incomplete publisher read on the next explicit load and retains known community rows", async () => {
    const kept = { venueId: "known-other-pub", drinkCategory: "soft-drink", priceGbp: 3.5,
      submittedAt: now, source: "community", corroborations: 2 };
    let attempt = 0;
    const fetcher = vi.fn(() => Promise.resolve(Response.json(attempt++ === 0
      ? { prices: [kept], listedPrices: [], truncated: false, degraded: true }
      : { prices: [], listedPrices: [soft], truncated: false })));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { container.querySelector("button")!.click(); });
    expect(current.noAlcoholIndexStatus).toBe("degraded");
    expect(current.byVenueId.get(kept.venueId)?.[0]).toMatchObject(kept);
    await act(async () => { container.querySelector("button")!.click(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(current.noAlcoholIndexStatus).toBe("ready");
    expect(current.byVenueId.get(kept.venueId)?.[0]).toMatchObject(kept);
    expect(discover(current.byVenueId, now, current.listedNoAlcoholPrices ?? []).get(soft.venueId))
      .toMatchObject({ source: "listed", priceGbp: 4.35, servingSize: null });
  });

  it.each([
    { truncated: false, degraded: false, status: "ready" },
    { truncated: true, degraded: false, status: "partial" },
    { truncated: false, degraded: true, status: "degraded" },
  ])("keeps official quotes while reporting $status without populating a selected-category cache", async (scenario) => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      () => new Promise<Response>((resolve) => { finish = resolve; }),
    );
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await act(async () => { container.querySelector("button")!.click(); });
    expect(current.noAlcoholIndexStatus).toBe("loading");
    expect(current.listedNoAlcoholPrices ?? []).toEqual([]);
    await act(async () => { finish(Response.json({ prices: [], listedPrices: [alcoholFree, soft],
      truncated: scenario.truncated, degraded: scenario.degraded })); });
    expect(current.noAlcoholIndexStatus).toBe(scenario.status);
    expect(discover(current.byVenueId, now, current.listedNoAlcoholPrices ?? []).get(soft.venueId))
      .toMatchObject({ source: "listed", category: "soft-drink", priceGbp: 4.35, servingSize: null });
    expect(current.listedNoAlcoholPrices).toEqual(expect.arrayContaining(published()));
    expect(current.listedNoAlcoholPrices).toHaveLength(2);
    expect(current.listedDrinkPrices.size).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe("/api/price-submit?lens=no-alcohol");
  });
});
