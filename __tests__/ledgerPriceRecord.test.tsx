// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ session: null, loading: false }) }));
vi.mock("@/components/map/VenuePriceThen", () => ({
  default: ({ currentPriceGbp, currentItem }: { currentPriceGbp?: number | null; currentItem?: unknown }) => <span data-current-price={currentPriceGbp ?? "none"} data-current-item={currentItem == null ? "unknown" : "known"} />,
}));
import { LedgerLiveProvider, LedgerPriceRecord } from "@/components/ledger/LedgerLive";
import type { LedgerPintPrice, LedgerPriceRecordData } from "@/lib/ledger";
import type { VenueListedPint } from "@/lib/venueListedPint";

let container: HTMLDivElement;
let root: Root;
const report: LedgerPintPrice = {
  dropId: "hatton-report", drink: "Lager", measure: "pint", priceGbp: 4.7,
  createdAt: "2026-09-06T01:22:18.585Z", handle: "a PUBMAXXER", state: "aged-out", split: null,
};
function view(listedPint: VenueListedPint | null = null, venueId = "venue-1vle947") {
  return <LedgerLiveProvider venueId={venueId}><LedgerPriceRecord venueId={venueId} listedPint={listedPint} /></LedgerLiveProvider>;
}
async function render() { await act(async () => root.render(view())); }
function answer(pintPrice: LedgerPintPrice | null, priceRecord?: LedgerPriceRecordData) {
  return new Response(JSON.stringify({ pintPrice, priceRecord, claims: [], entries: [], familyEntries: [] }));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Ledger price record", () => {
  it("renders the refreshed Small Beer menu winner instead of its July baseline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      pintPrice: null, claims: [], entries: [], familyEntries: [],
      priceRecord: {
        lane: { lane: "listed", listed: { priceGbp: 5, sourceUrl: "https://www.smallbeern8.co.uk/drinks", observedAt: "2026-10-23T16:15:47.970Z" } },
        drinkName: "Session IPA , 4.0%, Two by Two (Newcastle)", publisher: "smallbeern8.co.uk",
        reads: { bundle: "ready", sourced: "ready" },
      },
    }))));
    await act(async () => root.render(view({ priceGbp: 5.5, pintName: "Best Bitter", publisher: { label: "Small Beer", url: "https://www.smallbeern8.co.uk/drinks" }, observedOn: "2026-07-18" }, "venue-19mn6ss")));
    expect(container.textContent).toContain("£5.00");
    expect(container.textContent).not.toContain("£5.50");
    expect(container.textContent).toContain("Session IPA");
    expect(container.textContent).toContain("23 October 2026");
    expect(container.querySelector("time")?.dateTime).toBe("2026-10-23T16:15:47.970Z");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://www.smallbeern8.co.uk/drinks");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("5");
  });

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
  it("renders the sourced-refresh winner and its source date", async () => {
    const priceRecord: LedgerPriceRecordData = {
      lane: { lane: "sourced", cheapestPrice: 4.8, sourcedPrice: { provenance: "sourced", sourceLabel: "Pub website", sourceUrl: "https://example.com/drinks", observedAt: "2026-10-23T15:00:00Z" } },
      drinkName: null, publisher: null, reads: { bundle: "empty", sourced: "ready" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => answer(report, priceRecord)));
    await act(async () => root.render(view({ priceGbp: 5.5, pintName: "Lager", publisher: null, observedOn: "2026-07-18" })));
    expect(container.textContent).toContain("£4.80");
    expect(container.textContent).not.toContain("£5.50");
    expect(container.textContent).not.toContain("£4.70");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/drinks");
    expect(container.querySelector("time")?.dateTime).toBe("2026-10-23T15:00:00Z");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("4.8");
    expect(container.querySelector("[data-current-item]")?.getAttribute("data-current-item")).toBe("unknown");
  });
  it("does not turn unavailable published sources into an empty price record", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(null, {
      lane: null, drinkName: null, publisher: null, reads: { bundle: "unavailable", sourced: "unavailable" },
    })));
    await render();
    expect(container.textContent).toContain("did not answer");
    expect(container.textContent).not.toContain("No pint price");
  });
  it("labels a known fallback as incomplete when a published source read failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(null, {
      lane: { lane: "baseline", cheapestPrice: 5.5, standing: "listed", publisher: { label: "Pub website", url: "https://example.com/drinks" }, observedOn: "2026-07-18" },
      drinkName: "Lager", publisher: null, reads: { bundle: "unavailable", sourced: "ready" },
    })));
    await render();
    expect(container.textContent).toContain("£5.50");
    expect(container.textContent).toContain("18 July 2026");
    expect(container.textContent).toContain("may be incomplete");
    expect(container.textContent).not.toContain("No pint price");
  });
  it("keeps a supported published lane ahead of a public split without changing the split data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ...report, priceGbp: null, state: "disputed", split: { prices: [4.5, 4.7], reporters: 2 } }, {
      lane: { lane: "listed", listed: { priceGbp: 5, sourceUrl: "https://example.com/drinks", observedAt: "2026-10-23T16:00:00Z" } },
      drinkName: "Session IPA", publisher: "Pub website", reads: { bundle: "ready", sourced: "ready" },
    })));
    await render();
    expect(container.textContent).toContain("£5.00");
    expect(container.textContent).not.toContain("Two drinkers");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("5");
  });
  it("keeps the estimate label and withholds an observed historical comparison", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(null, {
      lane: { lane: "estimate", estimate: { priceGbp: 4.67, basis: "regional_baseline", sampleSize: 15, computedAt: "2026-10-05T12:00:00Z" } },
      drinkName: null, publisher: null, reads: { bundle: "ready", sourced: "ready" },
    })));
    await render();
    expect(container.textContent).toContain("est. £4.67");
    expect(container.textContent).toContain("modelled price");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("none");
  });
  it("renders a selected dispute without using its old baseline for historical comparison", async () => {
    const split = { prices: [4.5, 4.7], reporters: 2 };
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ...report, priceGbp: null, state: "disputed", split }, {
      lane: { lane: "disputed", split, observedAt: report.createdAt }, drinkName: null, publisher: null,
      reads: { bundle: "empty", sourced: "ready" },
    })));
    await act(async () => root.render(view({ priceGbp: 5.5, pintName: "Lager", publisher: null, observedOn: "2026-07-18" })));
    expect(container.textContent).toContain("Two drinkers, two prices: £4.50 and £4.70");
    expect(container.textContent).not.toContain("£5.50");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("none");
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
    await act(async () => root.render(view({ priceGbp: 5.5, pintName: "Lager", publisher: null, observedOn: "2026-10-02" })));
    expect(container.textContent).toContain("£5.50");
    expect(container.textContent).not.toContain("£4.70");
    expect(container.querySelector("time")?.dateTime).toBe("2026-10-02");
  });
  it.each(["logged-once", "corroborated", "confirmed"] as const)("uses the %s report before the baseline", async (state) => {
    const fresh = { ...report, priceGbp: 6, createdAt: "2026-10-23T16:00:00Z", state };
    vi.stubGlobal("fetch", vi.fn(async () => answer(fresh)));
    await act(async () => root.render(view({ priceGbp: 5, pintName: "Lager", publisher: null, observedOn: "2026-10-02" })));
    expect(container.textContent).toContain("£6.00");
    expect(container.textContent).not.toContain("£5.00");
    expect(container.querySelector("time")?.dateTime).toBe(fresh.createdAt);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/p/hatton-report");
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("6");
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
  it.each([null, { priceGbp: 5, pintName: "Lager", publisher: null, observedOn: "2026-10-02" }])("does not choose a price when reports disagree, baseline: %j", async (baseline) => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ...report, state: "disputed", priceGbp: null, split: { prices: [4.5, 4.7], reporters: 2 } })));
    await act(async () => root.render(view(baseline)));
    expect(container.textContent).toContain("Two drinkers, two prices: £4.50 and £4.70");
    expect(container.querySelector(".priceBadge")).toBeNull();
    expect(container.querySelector("[data-current-price]")?.getAttribute("data-current-price")).toBe("none");
  });
});
