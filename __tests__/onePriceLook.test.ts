// @vitest-environment jsdom

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceBadge, { PintPriceBadge } from "@/components/PriceBadge";
import CoffeePilotSheet from "@/components/map/CoffeePilotSheet";
import { SpillPreviewCard } from "@/components/map/composer/SpillPreviewCard";
import PalCardPrice from "@/components/pal/PalCardPrice";
import type { CoffeePilotCafe } from "@/lib/coffeePilot";
import type { PalCard } from "@/lib/palChat";
import { buildSpillPreview } from "@/lib/spillPreview";

function render(element: ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  return container;
}

function expectBadge(container: HTMLElement, price: string, band: string | null): void {
  const badges = container.querySelectorAll(".price-plaque");
  expect(badges).toHaveLength(1);
  const badge = badges[0]!;
  expect(badge.textContent).toBe(price);
  if (band) {
    expect(badge.classList.contains(`priceBand-${band.toLowerCase()}`)).toBe(true);
    expect(badge.getAttribute("title")).toMatch(new RegExp(`^${band}:`));
  } else {
    expect(badge.hasAttribute("title")).toBe(false);
    expect([...badge.classList].filter((name) => name.startsWith("priceBand-"))).toEqual([]);
  }
}

describe("the displayed price and its comparison", () => {
  it.each(["baseline", "current", "cheap", "increase", "neutral"] as const)(
    "prints a non-pint figure without a pint comparison in the %s variant",
    (variant) => {
      expectBadge(render(createElement(PriceBadge, { variant }, "£5.40")), "£5.40", null);
    },
  );

  it.each([
    { priceGbp: 1, label: "£1.00", band: "Cheap" },
    { priceGbp: 5.5, label: "£5.50", band: "Average" },
    { priceGbp: 100, label: "£100.00", band: "Expensive" },
  ])("prints $label with its $band pint comparison", ({ priceGbp, label, band }) => {
    expectBadge(render(createElement(PintPriceBadge, { priceGbp, venueId: "venue-e1srzr" })), label, band);
  });

  const card: PalCard = {
    key: "recorded-price", venueId: "venue-e1srzr", title: "Recorded price", place: "Soho",
    note: "", price: 5.5, provenance: { kind: "directory", label: "On record" },
  };

  it("prints the directory pint price with its comparison in a Pal card", () => {
    expectBadge(render(createElement(PalCardPrice, { card })), "£5.50", "Average");
  });

  it("prints an unmeasured observation without a pint comparison in a Pal card", () => {
    expectBadge(render(createElement(PalCardPrice, {
      card: { ...card, provenance: { kind: "community-price", label: "People-logged" } },
    })), "£5.50", null);
  });

  it("omits the price badge when a Pal card has no price", () => {
    expect(render(createElement(PalCardPrice, { card: { ...card, price: null } })).textContent).toBe("");
  });

  it("prints each listed coffee price without a pint comparison", () => {
    const cafe: CoffeePilotCafe = {
      id: "venue-osm-coffee", name: "Local cafe", address: "", lat: 51.52, lng: -0.08,
      prices: [
        { drink: "flat white", priceGbp: 3.4, sourceUrl: "https://example.com/menu", observedAt: "2026-10-02" },
        { drink: "latte", priceGbp: 3.6, sourceUrl: "https://example.com/menu", observedAt: "2026-10-02" },
      ],
    };
    const rows = render(createElement(CoffeePilotSheet, { cafe })).querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expectBadge(rows[0]!, "£3.40", null);
    expectBadge(rows[1]!, "£3.60", null);
  });

  it.each([
    { price: "5.4", label: "£5.40" },
    { price: "", label: null },
  ])("prints the submitted price or omits an absent price in the live preview: $price", ({ price, label }) => {
    const preview = buildSpillPreview({
      handle: "sam", price, note: "", withWho: "", drink: "", era: "",
      visibility: "public", venueName: "Local pub", hasPhoto: false,
    });
    const output = render(createElement(SpillPreviewCard, { preview, pintPhoto: null, visibility: "public" }));
    if (label) expectBadge(output, label, null);
    else expect(output.querySelectorAll(".price-plaque")).toHaveLength(0);
  });
});
