// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PlanCultureOpener from "@/components/plan/PlanCultureOpener";
import { CULTURE_WAYPOINT_UNKNOWN_NOTE, cleanCultureOpener } from "@/lib/cultureCrawl";

// The opener is read off a generate response the way the composer reads it,
// then rendered. The fixture is an ordinary gallery outing with three priced
// pints and a chosen budget of £40 each. Its source date is a labelled test
// fixture, and this file never judges freshness. Nothing here proves
// admission, opening times or a current price for the gallery.
const PRICE_SOURCE = {
  label: "Test fixture pint price",
  url: "https://example.org/test-fixture/pint-prices",
  observedAt: "2026-10-01T00:00:00.000Z",
};

const KNOWN_PINTS = [
  { venueId: "venue-1", venueName: "The First Stop", pence: 520, source: PRICE_SOURCE },
  { venueId: "venue-2", venueName: "The Second Stop", pence: 610, source: PRICE_SOURCE },
  { venueId: "venue-3", venueName: "The Third Stop", pence: 490, source: PRICE_SOURCE },
];

const BUDGET_COSTS = {
  limitPence: 4000,
  knownSubtotalPence: 1620,
  knownItems: KNOWN_PINTS,
  unknownItems: ["admission", "food", "transport"],
};

function galleryFragment(costs: unknown) {
  return {
    requested: ["gallery"],
    waypoint: {
      poiId: "poi-gallery-1",
      name: "Soho Photo Gallery",
      category: "sight",
      categoryLabel: "Sight",
      kind: "gallery",
      distanceKm: 0.4,
      coordinates: [-0.1365, 51.5136],
    },
    note: CULTURE_WAYPOINT_UNKNOWN_NOTE,
    costs,
  };
}

function render(fragment: unknown): string {
  return renderToStaticMarkup(<PlanCultureOpener opener={cleanCultureOpener(fragment)} />);
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parsed(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("PlanCultureOpener shows a budget outing as known and unknown costs", () => {
  it("itemises each recorded pint with its price and source date", () => {
    const html = render(galleryFragment(BUDGET_COSTS));
    const text = visibleText(html);
    for (const [name, price] of [
      ["The First Stop", "£5.20"],
      ["The Second Stop", "£6.10"],
      ["The Third Stop", "£4.90"],
    ]) {
      expect(text).toContain(name);
      expect(text).toContain(price);
    }
    const times = Array.from(parsed(html).querySelectorAll("time"));
    expect(times).toHaveLength(3);
    expect(times.map((time) => time.getAttribute("datetime"))).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
    expect(times.map((time) => time.textContent)).toEqual(["1 Oct 2026", "1 Oct 2026", "1 Oct 2026"]);
    expect(text.match(/Test fixture pint price/g) ?? []).toHaveLength(3);
  });

  it("labels the known subtotal as partial and lists the costs not known", () => {
    const html = render(galleryFragment(BUDGET_COSTS));
    const text = visibleText(html);
    expect(text).toContain("£16.20");
    expect(text).toMatch(/\bpartial\b/i);
    expect(html).toContain('aria-label="Costs not known"');
    for (const label of ["Admission", "Food", "Transport"]) {
      expect(html).toMatch(new RegExp(`<li[^>]*>${label}</li>`));
    }
    expect(text).not.toMatch(/\b(?:under|within) (?:your |the )?budget\b|\bfits\b|\bfree\b|\ball[- ]in\b/i);
  });

  it("keeps an alcohol-free outing without inventing a drink price", () => {
    const html = render(galleryFragment({
      limitPence: null,
      knownSubtotalPence: null,
      knownItems: [],
      unknownItems: ["admission", "drinks", "food", "transport"],
    }));
    expect(html).toContain("Soho Photo Gallery");
    expect(html).toMatch(/<li[^>]*>Drinks<\/li>/);
    expect(visibleText(html)).not.toContain("£");
  });

  it("keeps the waypoint unpriced and never numbers it as a fourth Stop", () => {
    for (const costs of [BUDGET_COSTS, undefined]) {
      const root = parsed(render(galleryFragment(costs)));
      const place = root.querySelector(".planComposer__openerPlace");
      expect(place?.textContent).toBe("Soho Photo GallerySight · 0.4 km from stop 1");
      expect(place?.querySelectorAll("time, li, button")).toHaveLength(0);
      expect(root.querySelectorAll("ol, button")).toHaveLength(0);
      expect(root.querySelector(".planComposer__number, .planComposer__swap, .planComposer__remove")).toBeNull();
      expect(root.textContent).not.toMatch(/\bstop [2-9]\b|\bfourth\b/i);
    }
    expect(visibleText(render(galleryFragment(undefined)))).not.toContain("£");
  });

  it.each<[string, unknown]>([
    ["a subtotal that is not the sum of its items", { ...BUDGET_COSTS, knownSubtotalPence: 900 }],
    ["an item price that is not a whole number of pence", {
      ...BUDGET_COSTS,
      knownItems: [{ ...KNOWN_PINTS[0], pence: "520" }, KNOWN_PINTS[1], KNOWN_PINTS[2]],
    }],
    ["an item with no price source", {
      ...BUDGET_COSTS,
      knownItems: [{ ...KNOWN_PINTS[0], source: null }, KNOWN_PINTS[1], KNOWN_PINTS[2]],
    }],
    ["an unknown cost outside the closed list", { ...BUDGET_COSTS, unknownItems: ["admission", "parking"] }],
    ["admission left out with no sourced admission fact", { ...BUDGET_COSTS, unknownItems: ["food", "transport"] }],
    ["drinks left out when no drink has a known price", {
      ...BUDGET_COSTS,
      knownSubtotalPence: null,
      knownItems: [],
    }],
    ["no unknown cost at all, which would read as an all-in total", { ...BUDGET_COSTS, unknownItems: [] }],
  ])("drops the cost list when it carries %s", (_label, costs) => {
    const opener = cleanCultureOpener(galleryFragment(costs));
    expect(opener?.waypoint?.name).toBe("Soho Photo Gallery");
    expect((opener as { costs?: unknown } | null)?.costs ?? null).toBeNull();
    expect(visibleText(render(galleryFragment(costs)))).not.toContain("£");
  });
});
