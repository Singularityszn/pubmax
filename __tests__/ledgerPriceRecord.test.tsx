// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ session: null, loading: false }) }));
vi.mock("@/components/map/VenuePriceThen", () => ({
  default: ({ currentPriceGbp }: { currentPriceGbp?: number | null }) => <span data-current-price={currentPriceGbp ?? "none"} />,
}));
import { LedgerLiveProvider, LedgerPriceRecord } from "@/components/ledger/LedgerLive";
import type { LedgerPintPrice } from "@/lib/ledger";
import type { VenueListedPint } from "@/lib/venueListedPint";
import type { VenuePrice } from "@/lib/venues";
import { venuePriceLane, venuePriceLaneObservedGbp, type VenueBundlePrices } from "@/lib/venuePriceLane";
import { defined } from "@/__tests__/helpers/defined";

type LedgerPriceVenue = ComponentProps<typeof LedgerPriceRecord>["venue"];

const seedRow = defined((JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[])[0]);

let container: HTMLDivElement;
let root: Root;
const report: LedgerPintPrice = {
  dropId: "hatton-report", drink: "Lager", measure: "pint", priceGbp: 4.7,
  createdAt: "2026-09-06T01:22:18.585Z", handle: "a PUBMAXXER", state: "aged-out", split: null,
};
function priceVenue(listedPint: VenueListedPint | null, venueId: string): LedgerPriceVenue {
  return {
    id: venueId, cheapestPrice: listedPint?.priceGbp ?? null, cheapestPint: listedPint?.pintName ?? "", sourcedPrice: null,
    prices: listedPint ? [{ ...seedRow, pint_name: listedPint.pintName ?? "", price_gbp: listedPint.priceGbp,
      pub_url: listedPint.publisher?.url ?? "", scraped_at_values: listedPint.observedOn ?? "" }] : [],
  };
}
function view(listedPint: VenueListedPint | null = null, venueId = "venue-1vle947", bundle: VenueBundlePrices = {}, sourcedPrice: LedgerPriceVenue["sourcedPrice"] = null) {
  const venue = { ...priceVenue(listedPint, venueId), sourcedPrice };
  return <LedgerLiveProvider venueId={venueId}><LedgerPriceRecord venue={venue} bundle={bundle} /></LedgerLiveProvider>;
}
async function render() { await act(async () => root.render(view())); }
function answer(pintPrice: LedgerPintPrice | null) {
  return new Response(JSON.stringify({ pintPrice, claims: [], entries: [], familyEntries: [] }));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Ledger price record", () => {
  it("shows Hatton's public price, source, serving and London date after the live read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(report)));
    await render();
    expect(container.textContent).toContain("£4.70");
    expect(container.textContent).toContain("Lager · Pint");
    expect(container.textContent).toContain("a PUBMAXXER");
    expect(container.querySelector("time")?.dateTime).toBe(report.createdAt);
    expect(container.textContent).toContain("6 September 2026");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/p/hatton-report");
    expect(container.textContent).toContain("Over 30 days old");
    expect(container.textContent).not.toContain("No pint price");
  });
  it("keeps Hatton's dated report without a competing modelled figure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(report)));
    await act(async () => root.render(view(null, "venue-1vle947", { estimate: {
      priceGbp: 6.5, basis: "regional_baseline", sampleSize: 120, computedAt: "2026-10-01T12:00:00Z",
    } })));
    expect(container.textContent).toContain("£4.70");
    expect(container.textContent).toContain("Over 30 days old");
    expect(container.textContent).not.toContain("£6.50");
  });
  it("keeps the cached server document neutral until public reports are read", () => {
    const html = renderToStaticMarkup(view(null, "venue-1vle947", { estimate: {
      priceGbp: 6.5, basis: "regional_baseline", sampleSize: 120, computedAt: "2026-10-01T12:00:00Z",
    } }));
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.body.textContent).toContain("Checking the price record");
    expect(document.body.textContent).not.toContain("£6.50");
    expect(document.body.textContent).not.toContain("Nobody has published");
  });
  it("waits for a delayed public report without flashing the estimate", async () => {
    let resolveRead: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveRead = resolve; })));
    await act(async () => root.render(view(null, "venue-1vle947", { estimate: {
      priceGbp: 6.5, basis: "regional_baseline", sampleSize: 120, computedAt: "2026-10-01T12:00:00Z",
    } })));
    expect(container.textContent).toContain("Checking the price record");
    expect(container.textContent).not.toContain("£6.50");
    await act(async () => resolveRead(answer(report)));
    expect(container.textContent).toContain("£4.70");
    expect(container.textContent).toContain("Over 30 days old");
    expect(container.textContent).not.toContain("£6.50");
  });
  it("offers retry after a failed public read and estimates only after a successful empty read", async () => {
    let rejectRead: (error: Error) => void = () => {};
    let resolveRetry: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectRead = reject; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRetry = resolve; })));
    await act(async () => root.render(view(null, "venue-1vle947", { estimate: {
      priceGbp: 6.5, basis: "regional_baseline", sampleSize: 120, computedAt: "2026-10-01T12:00:00Z",
    } })));
    await act(async () => rejectRead(new Error("unavailable")));
    expect(container.textContent).toContain("did not answer");
    expect(container.textContent).not.toContain("£6.50");
    expect(container.textContent).not.toContain("Nobody has published");
    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("Checking the price record");
    expect(container.textContent).not.toContain("£6.50");
    await act(async () => resolveRetry(answer(null)));
    expect(container.textContent).toContain("Estimated pint price");
    expect(container.textContent).toContain("£6.50");
    expect(container.textContent).not.toContain("did not answer");
  });
  it("explains a modelled pint price when there is no report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(null)));
    await act(async () => root.render(view(null, "venue-1vle947", { estimate: {
      priceGbp: 6.5, basis: "regional_baseline", sampleSize: 120, computedAt: "2026-10-01T12:00:00Z",
    } })));
    expect(container.textContent).toContain("Estimated pint price");
    expect(container.textContent).toContain("est. £6.50");
    expect(container.textContent).toContain("120 published prices");
    expect(container.textContent).toContain("regional baseline");
    expect(container.textContent).toContain("not a quote");
    expect(container.querySelector('a[href="/how-we-estimate"]')?.textContent).toBe("How we estimate");
    expect(container.querySelector("time")?.dateTime).toBe("2026-10-01T12:00:00Z");
  });
  it("does not claim absence while loading or when the store fails", async () => {
    let rejectRead: (error: Error) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectRead = reject; })));
    await render();
    expect(container.textContent).toContain("Checking the price record");
    await act(async () => rejectRead(new Error("unavailable")));
    expect(container.textContent).toContain("did not answer");
    expect(container.textContent).not.toContain("No pint price");
  });
  it("states absence only after a successful empty read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(null)));
    await render();
    expect(container.textContent).toContain("No pint price is on record yet");
  });
  it("keeps the baseline priority over an aged report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(report)));
    await act(async () => root.render(view({ priceGbp: 5.5, pintName: "Lager", publisher: { label: "example.com", url: "https://example.com/menu" }, observedOn: "2026-10-02" })));
    expect(container.textContent).toContain("£5.50");
    expect(container.textContent).toContain("£4.70");
    expect(container.querySelector("time")?.dateTime).toBe("2026-10-02");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("5.5");
  });
  it.each(["logged-once", "corroborated", "confirmed"] as const)("uses the %s report before the baseline", async (state) => {
    const fresh = { ...report, priceGbp: 6, createdAt: "2026-10-23T16:00:00Z", state };
    vi.stubGlobal("fetch", vi.fn(async () => answer(fresh)));
    await act(async () => root.render(view({ priceGbp: 5, pintName: "Lager", publisher: { label: "example.com", url: "https://example.com/menu" }, observedOn: "2026-10-02" })));
    expect(container.textContent).toContain("£6.00");
    expect(container.textContent).toContain("£5.00");
    expect(container.querySelector("time")?.dateTime).toBe(fresh.createdAt);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/p/hatton-report");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("6");
  });
  it.each(["logged-once", "disputed", "aged-out"] as const)("keeps Small Beer's published listing above a %s report and labels both facts", async (state) => {
    const fresh: LedgerPintPrice = { ...report, dropId: "small-beer-report", priceGbp: state === "disputed" ? null : 6,
      createdAt: state === "aged-out" ? "2026-08-23T16:00:00Z" : "2026-10-23T16:00:00Z", state, split: state === "disputed" ? { prices: [6, 6.5], reporters: 2 } : null };
    const bundle = { listed: { priceGbp: 5, sourceUrl: "https://www.smallbeern8.co.uk/drinks", publisher: "smallbeern8.co.uk", observedAt: "2026-09-21T18:58:02.492Z" } };
    vi.stubGlobal("fetch", vi.fn(async () => answer(fresh)));
    await act(async () => root.render(view(null, "venue-19mn6ss", bundle)));
    const mapLane = venuePriceLane({ cheapestPrice: null }, null, null, bundle,
      state === "logged-once" ? { priceGbp: 6, observedAt: fresh.createdAt } : null,
      state === "aged-out" ? { priceGbp: 6, observedAt: fresh.createdAt } : null,
      fresh.split ? { split: fresh.split, observedAt: fresh.createdAt } : null);
    if (!mapLane) throw new Error("Small Beer must have a listed lane");
    expect(mapLane.lane).toBe("listed");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe(String(venuePriceLaneObservedGbp(mapLane)));
    expect(container.querySelector(".priceBadge")?.textContent).toBe("£5.00");
    expect(container.textContent).toContain("£6.00");
    expect(container.textContent).toContain("Published price");
    expect(container.textContent).toContain("Public pint report");
    expect(container.querySelector('a[href="https://www.smallbeern8.co.uk/drinks"]')?.textContent).toBe("smallbeern8.co.uk");
    expect(container.querySelector('a[href="/p/small-beer-report"]')?.textContent).toBe("View Pint Drop");
    expect([...container.querySelectorAll("time")].map((time) => time.dateTime)).toEqual([bundle.listed.observedAt, fresh.createdAt]);
  });
  it.each([undefined, null, "", "   "])("discloses a missing publisher without inventing one (%s)", async (publisher) => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(null)));
    await act(async () => root.render(view(null, "venue-19mn6ss", { listed: {
      priceGbp: 5, sourceUrl: "https://www.smallbeern8.co.uk/drinks", publisher, observedAt: "2026-09-21T18:58:02.492Z",
    } })));
    expect(container.textContent).toContain("Publisher not recorded");
    expect(container.querySelector('a[href="https://www.smallbeern8.co.uk/drinks"]')).toBeNull();
    expect(container.textContent).toContain("£5.00");
  });
  it("keeps a recorded publisher as text when its URL is unsafe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(null)));
    await act(async () => root.render(view(null, "venue-19mn6ss", { listed: {
      priceGbp: 5, sourceUrl: "javascript:alert(1)", publisher: "Small Beer", observedAt: "2026-09-21T18:58:02.492Z",
    } })));
    expect(container.textContent).toContain("Listed by Small Beer");
    expect(container.textContent).toContain("Link unavailable.");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.textContent).not.toContain("Publisher not recorded");
  });
  it.each(["corroborated", "confirmed"] as const)("keeps the %s report above a published listing", async (state) => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ...report, priceGbp: 6, createdAt: "2026-10-23T16:00:00Z", state })));
    const bundle = { listed: { priceGbp: 5, sourceUrl: "https://www.smallbeern8.co.uk/drinks", publisher: "smallbeern8.co.uk", observedAt: "2026-09-21T18:58:02.492Z" } };
    await act(async () => root.render(view(null, "venue-19mn6ss", bundle)));
    expect(container.querySelector(".priceBadge")?.textContent).toBe("£6.00");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("6");
    expect(container.textContent).toContain("£5.00");
    expect(container.querySelector('a[href="https://www.smallbeern8.co.uk/drinks"]')).not.toBeNull();
  });
  it("keeps the published price while the public read is pending or fails", async () => {
    let rejectRead: (error: Error) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectRead = reject; })));
    const bundle = { listed: { priceGbp: 5, sourceUrl: "https://www.smallbeern8.co.uk/drinks", publisher: "smallbeern8.co.uk", observedAt: "2026-09-21T18:58:02.492Z" } };
    await act(async () => root.render(view(null, "venue-19mn6ss", bundle)));
    expect(container.querySelector(".priceBadge")?.textContent).toBe("£5.00");
    expect(container.textContent).not.toContain("Public pint report");
    await act(async () => rejectRead(new Error("unavailable")));
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("5");
    expect(container.textContent).not.toContain("No pint price");
  });
  it("keeps a sourced listing above a lone report and the bundle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ...report, priceGbp: 6, state: "logged-once" })));
    const listing = { priceGbp: 5.5, pintName: "Lager", publisher: null, observedOn: "2026-10-02" };
    const sourcedPrice = { provenance: "sourced" as const, sourceLabel: "Pub menu", sourceUrl: "https://example.com/drinks", observedAt: "2026-10-20T12:00:00Z" };
    await act(async () => root.render(view(listing, "venue-1vle947", { listed: { priceGbp: 5, sourceUrl: "https://example.com/older", observedAt: "2026-10-01" } }, sourcedPrice)));
    expect(container.querySelector(".priceBadge")?.textContent).toBe("£5.50");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("5.5");
    expect(container.querySelector('a[href="https://example.com/drinks"]')?.textContent).toBe("Pub menu");
    expect(container.textContent).toContain("£6.00");
    expect(container.querySelector("time")?.dateTime).toBe(sourcedPrice.observedAt);
  });
  it("removes the previous pub's price immediately when the next pub read is pending", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("venue-1vle947")
      ? Promise.resolve(answer(report)) : new Promise<Response>(() => {})));
    await render();
    expect(container.textContent).toContain("£4.70");
    await act(async () => root.render(view(null, "venue-xjf3n0")));
    expect(container.textContent).not.toContain("£4.70");
    expect(container.textContent).toContain("Checking the price record");
  });
  it.each([null, { priceGbp: 5, pintName: "Lager", publisher: { label: "example.com", url: "https://example.com/menu" }, observedOn: "2026-10-02" }])("does not choose a price when reports disagree, baseline: %j", async (baseline) => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ...report, state: "disputed", priceGbp: null, split: { prices: [4.5, 4.7], reporters: 2 } })));
    await act(async () => root.render(view(baseline)));
    expect(container.textContent).toContain("Two drinkers, two prices: £4.50 and £4.70");
    expect(container.querySelectorAll(".priceBadge")).toHaveLength(baseline ? 1 : 0);
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("none");
  });
});
