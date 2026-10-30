// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapPriceFilterChips from "@/components/map/MapPriceFilterChips";
import MobilePriceChoices, { PRICE_CHOICES } from "@/components/map/MobilePriceChoices";
import { mapPriceLegend } from "@/lib/mapPriceLegend";
import {
  nearestPintPriceCap,
  nearestPintPriceCapIndex,
  PINT_PRICE_CAPS,
  PINT_PRICE_CAPS_ASCENDING,
  pintPriceCapIsActive,
} from "@/lib/pintPriceCaps";
import { initialFilters, NO_PINT_PRICE_CAP } from "@/lib/venues";

// ONE SET OF PINT PRICE CAPS (launch UX micro-fix 3). The desktop chips, the
// phone's segmented row and the rail slider each offered a different set. They
// read lib/pintPriceCaps.ts now, so a reader meets the same four answers at
// every width.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the shared pint price caps", () => {
  it("is four caps, Any first, and Any is the one OFF value", () => {
    expect(PINT_PRICE_CAPS.map((cap) => cap.maxPrice)).toEqual([NO_PINT_PRICE_CAP, 7, 6, 5.5]);
    expect(PINT_PRICE_CAPS.map((cap) => cap.label)).toEqual(["Any", "≤ £7", "≤ £6", "≤ £5.50"]);
    expect(PINT_PRICE_CAPS.map((cap) => cap.shortLabel)).toEqual(["Any", "£7", "£6", "£5.50"]);
    expect(PINT_PRICE_CAPS_ASCENDING.map((cap) => cap.maxPrice)).toEqual([5.5, 6, 7, NO_PINT_PRICE_CAP]);
  });

  it("snaps any figure to its nearest cap, and a tie to the looser one", () => {
    expect(nearestPintPriceCap(5.5).maxPrice).toBe(5.5);
    expect(nearestPintPriceCap(5.6).maxPrice).toBe(5.5);
    expect(nearestPintPriceCap(5.75).maxPrice).toBe(6);
    expect(nearestPintPriceCap(6.5).maxPrice).toBe(7);
    expect(nearestPintPriceCap(8.5).maxPrice).toBe(NO_PINT_PRICE_CAP);
    expect(nearestPintPriceCap(4).maxPrice).toBe(5.5);
    expect(nearestPintPriceCap(99).maxPrice).toBe(NO_PINT_PRICE_CAP);
    expect(nearestPintPriceCap(Number.NaN).maxPrice).toBe(NO_PINT_PRICE_CAP);
    expect(nearestPintPriceCapIndex(initialFilters.maxPrice)).toBe(PINT_PRICE_CAPS_ASCENDING.length - 1);
  });

  it("reads every figure at or over the OFF value as Any", () => {
    expect(pintPriceCapIsActive(NO_PINT_PRICE_CAP, NO_PINT_PRICE_CAP)).toBe(true);
    expect(pintPriceCapIsActive(12, NO_PINT_PRICE_CAP)).toBe(true);
    expect(pintPriceCapIsActive(7, NO_PINT_PRICE_CAP)).toBe(false);
    expect(pintPriceCapIsActive(6, 6)).toBe(true);
  });

  it("offers the same caps on the desktop chips and the phone row", () => {
    const chips = renderToStaticMarkup(
      createElement(MapPriceFilterChips, {
        filters: initialFilters,
        onFiltersChange: () => undefined,
        onPicked: () => undefined,
      }),
    );
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: { priceBands: [{ meaning: "pint", bucket: 0 }], storyColour: null, clusterPrices: false },
    });
    const phone = renderToStaticMarkup(
      createElement(MobilePriceChoices, { maxPrice: 6, legend, onMaxPriceChange: () => undefined }),
    );
    const labels = (html: string, pattern: RegExp) =>
      Array.from(html.matchAll(pattern), (match) => (match[1] ?? "").replace(/<[^>]+>/g, "").trim());

    expect(labels(chips, /<button[^>]*mapLayersPriceChip[^>]*>([\s\S]*?)<\/button>/g)).toEqual(
      PINT_PRICE_CAPS.map((cap) => cap.label),
    );
    expect(labels(phone, /<button[^>]*>([\s\S]*?)<\/button>/g)).toEqual(
      PINT_PRICE_CAPS.map((cap) => cap.shortLabel),
    );
    expect(phone).toMatch(/class="isActive" aria-pressed="true">£6</);
    expect([...PRICE_CHOICES]).toEqual(PINT_PRICE_CAPS.map((cap) => cap.maxPrice));
  });
});

describe("the rail's max pint slider", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("walks the shared caps and writes only a cap the chips also offer", async () => {
    const { default: ControlRail } = await import("@/components/map/ControlRail");
    const onFiltersChange = vi.fn();
    const noop = () => undefined;
    const props = {
      mode: "suggest",
      onModeChange: noop,
      filters: { ...initialFilters, maxPrice: 6.25 },
      onFiltersChange,
      filteredVenues: [],
      builtCount: 0,
      onClearBuilt: noop,
      onLoadCrawl: noop,
      onNearbyCrawl: noop,
      nearbyLoading: false,
      nearbyError: null,
      savedOnly: false,
      onSavedOnlyChange: noop,
    } as never;
    act(() => root.render(createElement(ControlRail, props)));

    const slider = host.querySelector<HTMLInputElement>('input[aria-label="Maximum pint price"]');
    expect(slider).not.toBeNull();
    expect(slider!.min).toBe("0");
    expect(slider!.max).toBe(String(PINT_PRICE_CAPS_ASCENDING.length - 1));
    expect(slider!.step).toBe("1");
    // An old figure (£6.25) shows as the cap it snaps to.
    expect(slider!.value).toBe("1");
    expect(slider!.getAttribute("aria-valuetext")).toBe("≤ £6");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const index of [0, 2, 3]) {
      act(() => {
        setValue.call(slider, String(index));
        slider!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const written = onFiltersChange.mock.calls.at(-1)?.[0] as { maxPrice: number } | undefined;
      expect(written?.maxPrice).toBe(PINT_PRICE_CAPS_ASCENDING[index]?.maxPrice);
    }
    expect(onFiltersChange).toHaveBeenCalledTimes(3);
  });
});

// Review finding 4 (PR 2402): a cap that came from an old link, a saved phone
// session or the onboarding budget must be the cap every control prints. The
// rail showed "≤ £6" while a £6.25 cap still filtered the map.
describe("every cap control prints the cap the map applies", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function owners(): Promise<Array<[string, number]>> {
    const { seedCrawlState } = await import("@/lib/crawlUrl");
    const { validateMobileMapFilters } = await import("@/lib/mobileShell");
    const { desktopHandoffMoves } = await import("@/lib/onboardingFlow");
    return [
      ["an old link", seedCrawlState("?max=6.25").filters.maxPrice],
      ["a saved phone session", validateMobileMapFilters({ ...initialFilters, maxPrice: 6.25 })!.maxPrice],
      ["the onboarding budget", desktopHandoffMoves({ patch: null, budget: "five" }).maxPrice!],
    ];
  }

  it("applies only a shared cap, whatever figure it was handed", async () => {
    for (const [source, applied] of await owners()) {
      expect(PINT_PRICE_CAPS.map((cap) => cap.maxPrice), source).toContain(applied);
    }
  });

  it("lights the one cap the map applies on the slider, the chips and the phone row", async () => {
    const { default: ControlRail } = await import("@/components/map/ControlRail");
    const noop = () => undefined;
    const legend = mapPriceLegend({
      kind: "default",
      renderedState: { priceBands: [{ meaning: "pint", bucket: 0 }], storyColour: null, clusterPrices: false },
    });
    for (const [source, applied] of await owners()) {
      const filters = { ...initialFilters, maxPrice: applied };
      const capFor = PINT_PRICE_CAPS.find((cap) => cap.maxPrice === applied);
      expect(capFor, source).toBeDefined();

      act(() =>
        root.render(
          createElement(ControlRail, {
            mode: "suggest",
            onModeChange: noop,
            filters,
            onFiltersChange: noop,
            filteredVenues: [],
            builtCount: 0,
            onClearBuilt: noop,
            onLoadCrawl: noop,
            onNearbyCrawl: noop,
            nearbyLoading: false,
            nearbyError: null,
            savedOnly: false,
            onSavedOnlyChange: noop,
          } as never),
        ),
      );
      const slider = host.querySelector<HTMLInputElement>('input[aria-label="Maximum pint price"]');
      expect(slider?.getAttribute("aria-valuetext"), source).toBe(capFor?.label);

      const chips = renderToStaticMarkup(
        createElement(MapPriceFilterChips, { filters, onFiltersChange: noop, onPicked: noop }),
      );
      expect(chips.match(/aria-pressed="true"/g)?.length, source).toBe(1);
      expect(chips, source).toContain(`${capFor?.label}</button>`);
      expect(chips, source).toMatch(new RegExp(`aria-pressed="true"><i[^>]*></i>${capFor?.label}<`));

      const phone = renderToStaticMarkup(
        createElement(MobilePriceChoices, { maxPrice: applied, legend, onMaxPriceChange: noop }),
      );
      expect(phone.match(/aria-pressed="true"/g)?.length, source).toBe(1);
      expect(phone, source).toContain(`aria-pressed="true">${capFor?.shortLabel}<`);
    }
  });
});
