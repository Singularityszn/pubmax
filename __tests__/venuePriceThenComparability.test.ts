// @vitest-environment jsdom

// The venue sheet's "What it used to cost" block, read through the real
// history loader. Both dated figures and the archive's source always print; a
// line saying the pint went up or down prints only when both figures state the
// same drink, the same serving and an ordinary price.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenuePriceThen from "@/components/map/VenuePriceThen";
import type { PriceComparisonItem } from "@/lib/priceHistory";
import { resetPriceHistoryLoader } from "@/lib/priceHistoryLoader";
import { PRICE_NOT_COMPARED_LINE } from "@/lib/priceMovementLine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VENUE_ID = "venue-moon";
const BUD_LIGHT: PriceComparisonItem = { drink: "Bud Light", measure: "pint", terms: "standard" };
const MOVEMENT = /\b(?:Up|Down) £\d|\bSame price\b/;

function historyFile(item?: PriceComparisonItem) {
  return {
    version: 1,
    generatedAt: "2026-07-27",
    observations: [
      {
        venueId: VENUE_ID,
        venueName: "The Moon on the Hill",
        priceGbp: 2.89,
        observedOn: "2013-04-24",
        ...(item ? { item } : {}),
        source: {
          label: "beerintheevening.com",
          url: "https://www.beerintheevening.com/pubs/moon",
          licence: "quoted with attribution",
        },
      },
    ],
  };
}

describe("the venue sheet's then line", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    resetPriceHistoryLoader();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    resetPriceHistoryLoader();
    vi.unstubAllGlobals();
  });

  async function show(file: unknown, currentPriceGbp: number | null, currentItem: PriceComparisonItem | null = null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(file), { status: 200 })),
    );
    act(() => root.render(createElement(VenuePriceThen, { venueId: VENUE_ID, currentPriceGbp, currentItem })));
    for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve());
  }

  it("keeps both figures, the source and the day, and claims no movement when the archive names no pint", async () => {
    await show(historyFile(), 2.43);
    const words = container.textContent ?? "";
    expect(container.querySelector(".vptThen")?.textContent).toBe("£2.89");
    expect(container.querySelector(".vptNow")?.textContent).toBe("£2.43");
    expect(words).toContain("April 2013.");
    expect(container.querySelector(".vptSource a")?.getAttribute("href")).toBe(
      "https://www.beerintheevening.com/pubs/moon",
    );
    expect(container.querySelector(".vptSource")?.textContent).toBe("beerintheevening.com, 24 April 2013");
    expect(container.querySelector(".vptMovement")).toBeNull();
    expect(words).not.toMatch(MOVEMENT);
    expect(words).toContain(PRICE_NOT_COMPARED_LINE);
  });

  it("claims no movement when today's figure is a different serving of the same drink", async () => {
    await show(historyFile(BUD_LIGHT), 2.43, { ...BUD_LIGHT, measure: "half" });
    const words = container.textContent ?? "";
    expect(container.querySelector(".vptThen")?.textContent).toBe("£2.89");
    expect(container.querySelector(".vptNow")?.textContent).toBe("£2.43");
    expect(container.querySelector(".vptMovement")).toBeNull();
    expect(words).not.toMatch(MOVEMENT);
    expect(words).toContain(PRICE_NOT_COMPARED_LINE);
  });

  it("says the movement when both figures state the same pint at an ordinary price", async () => {
    await show(historyFile(BUD_LIGHT), 2.43, { drink: "BUD LIGHT", measure: "pint", terms: "standard" });
    expect(container.querySelector(".vptNow")?.textContent).toBe("£2.43");
    expect(container.querySelector(".vptMovement")?.textContent).toMatch(/^Down £0\.46 in \d+ years\.$/);
    expect(container.textContent ?? "").not.toContain(PRICE_NOT_COMPARED_LINE);
  });
});
