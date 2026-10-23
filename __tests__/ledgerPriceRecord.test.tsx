// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ session: null, loading: false }) }));
vi.mock("@/components/map/VenuePriceThen", () => ({ default: () => null }));
import { LedgerLiveProvider, LedgerPriceRecord } from "@/components/ledger/LedgerLive";
import type { LedgerPintPrice } from "@/lib/ledger";
import type { VenueListedPint } from "@/lib/venueListedPint";

let container: HTMLDivElement;
let root: Root;
const report: LedgerPintPrice = {
  dropId: "hatton-report", drink: "Lager", measure: "pint", priceGbp: 4.7,
  createdAt: "2026-09-06T01:22:18.585Z", handle: "a PUBMAXXER", state: "aged-out", splitLine: null,
};
function view(listedPint: VenueListedPint | null = null, venueId = "venue-1vle947") {
  return <LedgerLiveProvider venueId={venueId}><LedgerPriceRecord venueId={venueId} listedPint={listedPint} /></LedgerLiveProvider>;
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
  it("keeps the listed-source priority over an unconfirmed report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(report)));
    await act(async () => root.render(view({ priceGbp: 5.5, pintName: "Lager", publisher: null, observedOn: "2026-10-02" })));
    expect(container.textContent).toContain("£5.50");
    expect(container.textContent).not.toContain("£4.70");
    expect(container.querySelector("time")?.dateTime).toBe("2026-10-02");
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
  it("does not choose a price when reports disagree", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ...report, state: "disputed", priceGbp: null, splitLine: "Two drinkers, two prices: £4.50 and £4.70" })));
    await render();
    expect(container.textContent).toContain("Two drinkers, two prices: £4.50 and £4.70");
    expect(container.querySelector(".priceBadge")).toBeNull();
  });
});
