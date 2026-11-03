// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TonightAnswerCards from "@/components/tonight/TonightAnswerCards";
import { tonightCheapestAnswer } from "@/lib/tonightAnswers";
import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";
import { offlineCache } from "@/lib/offlineCache";
import { buildSlimPriceEvidence, selectSlimPriceRow } from "@/scripts/build_slim_index.mjs";

const mounted: Array<ReturnType<typeof createRoot>> = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(cheapest: ReturnType<typeof tonightCheapestAnswer>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => root.render(createElement(TonightAnswerCards, {
    cheapest, listing: null, regular: null, lastTrain: { status: "no-location" },
    onShareLocation: () => undefined,
  })));
  return container.querySelector('[data-testid="tonight-answer-cheapest"]') as HTMLElement;
}

describe("Tonight's selected pint evidence", () => {
  it("shows the chosen city's drink, serving, publisher link and full read day", async () => {
    const cheapest = tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [{
      venueId: "selected", name: "Selected Arms", borough: "Soho", priceGbp: 4.5, chain: null,
      drinkLabel: "House Lager", servingSize: "Pint", publisher: { label: "The menu", url: "https://example.org/menu" }, observedAt: "2026-10-02T12:00:00Z",
    }] });
    const card = await show(cheapest);
    expect(card.textContent).toContain("House Lager");
    expect(card.textContent).toContain("Pint");
    expect(card.textContent).toContain("The menu");
    expect(card.querySelector('a[href="https://example.org/menu"]')?.textContent).toBe("The menu");
    expect(card.textContent).toContain("2 Oct 2026");
  });

  it("states unavailable evidence for a nearby selected row without borrowing city facts", async () => {
    const cheapest = tonightCheapestAnswer({ origin: { lat: 51.51, lng: -0.13 }, patch: null,
      nearby: [{ id: "near", name: "Near Arms", lat: 51.51, lng: -0.13, cheapestPrice: 4.5, priceSource: "Near source", priceObservedAt: "2026-07-03" }],
      cityRows: [{ venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 4.5, chain: null,
        drinkLabel: "Other lager", servingSize: "Pint", publisher: { label: "Other menu", url: "https://example.org/other" }, observedAt: "2026-10-02" }],
    });
    const card = await show(cheapest);
    expect(card.textContent).toContain("Drink not recorded");
    expect(card.textContent).toContain("Serving not recorded");
    expect(card.textContent).toContain("Near source (link unavailable)");
    expect(card.textContent).toContain("3 Jul 2026");
    expect(card.textContent).not.toContain("Other menu");
    expect(card.textContent).not.toContain("Other lager");
  });

  it("states missing publisher and date on a legacy city row", async () => {
    const cheapest = tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [{
      venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 4.5, chain: null,
    }] });
    const card = await show(cheapest);
    expect(card.textContent).toContain("Publisher not recorded");
    expect(card.textContent).toContain("Read date not recorded");
  });

  it("does not link an unsafe publisher URL", async () => {
    const cheapest = tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [{
      venueId: "city", name: "City Arms", borough: "Soho", priceGbp: 4.5, chain: null,
      publisher: { label: "Menu", url: "javascript:alert(1)" },
    }] });
    const card = await show(cheapest);
    expect(card.textContent).toContain("Menu (link unavailable)");
    expect(card.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("carries one selected row through the slim producer and reader to the nearby card", async () => {
    const priceRows = [
      { price_gbp: 4.5, pint_name: "First lager", measure: "pint", pub_url: "https://first.example/menu", scraped_at_values: "2026-07-03T12:00:00Z" },
      { price_gbp: 4.5, pint_name: "Other lager", measure: "pint", pub_url: "https://other.example/menu", scraped_at_values: "2026-10-02T12:00:00Z" },
    ];
    const evidence = buildSlimPriceEvidence(selectSlimPriceRow(priceRows));
    vi.spyOn(offlineCache, "get").mockResolvedValue(null);
    vi.spyOn(offlineCache, "set").mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{
      id: "near", name: "Near Arms", lat: 51.51, lng: -0.13, borough: "Soho", cheapestPrice: 4.5, ...evidence,
    }] }));
    const { rows } = await loadSlimVenuesFromPathResult("/data/tonight-evidence-test.json");
    const card = await show(tonightCheapestAnswer({ origin: { lat: 51.51, lng: -0.13 }, patch: null, nearby: rows, cityRows: [] }));
    expect(card.textContent).toContain("First lager");
    expect(card.textContent).toContain("pint");
    expect(card.textContent).toContain("3 Jul 2026");
    expect(card.querySelector('a[href="https://first.example/menu"]')?.textContent).toBe("first.example");
    expect(card.textContent).not.toContain("Other lager");
    expect(card.textContent).not.toContain("2 Oct 2026");
  });
});
