// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BeerMats, { matRim } from "@/components/wild/BeerMats";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";

const READ = "2026-10-02T11:48:33.000Z";
const ROWS: TonightCheapPint[] = [
  { venueId: "venue-a", name: "J.J. Moon's", borough: "Wandsworth", priceGbp: 2.09, chain: "wetherspoon", observedAt: READ, drinkLabel: "Jaipur", servingSize: "pint", publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" } },
  { venueId: "venue-b", name: "The Unread", borough: "Camden", priceGbp: 4.5, chain: null },
];
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("the beer mats", () => {
  it("keeps the rim legible for short and long names", () => {
    const short = matRim({ ...ROWS[0]!, name: "Ship", borough: "Wapping", chain: null });
    expect(short.text).toBe("SHIP · WAPPING · SHIP · WAPPING · ");
    expect(matRim(ROWS[0]!).fontSize).toBeGreaterThanOrEqual(9);
  });

  it("lets a reader turn a mat and reach only its active back", () => {
    act(() => root.render(createElement(BeerMats, { rows: ROWS })));
    const button = host.querySelector<HTMLButtonElement>("button.beerMatToggle")!;
    const back = host.querySelector<HTMLElement>(".beerMatBack")!;
    expect(button.getAttribute("aria-label")).toBe("J.J. Moon's, Wandsworth, Wetherspoon, £2.09");
    expect(back.hasAttribute("inert")).toBe(true);
    act(() => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(back.hasAttribute("inert")).toBe(false);
    expect(back.textContent).toContain("Jaipur");
    expect(back.querySelector('a[href="https://www.pint-prices.com/pub/x"]')).not.toBeNull();
    expect(back.querySelector("a.beerMatLog")?.getAttribute("href")).toBe("/map?sel=venue-a&log=1");
    act(() => button.click());
    expect(back.hasAttribute("inert")).toBe(true);
  });

  it("states which evidence is missing instead of inventing it", () => {
    act(() => root.render(createElement(BeerMats, { rows: ROWS })));
    const back = host.querySelectorAll(".beerMatBack")[1]!;
    expect(back.textContent).toContain("Drink not recorded");
    expect(back.textContent).toContain("Serving not recorded");
    expect(back.textContent).toContain("No publisher recorded");
    expect(back.textContent).toContain("Read day not recorded");
  });
});
