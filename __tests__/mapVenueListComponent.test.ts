// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DrinkLanePicker from "@/components/map/DrinkLanePicker";
import MapVenueList from "@/components/map/MapVenueList";
import type { MapVenueListModel, UkBasePubListModel } from "@/lib/mapVenueList";

const emptyBase: UkBasePubListModel = {
  rows: [],
  total: 0,
  shown: 0,
  truncated: false,
};

describe("MapVenueList", () => {
  it("announces rendered base pubs as a distinct group without a listed price", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };
    const base: UkBasePubListModel = {
      rows: [
        {
          id: "venue-uk-n123",
          name: "Base Arms",
          priceLabel: "Other pub · no listed price",
          pub: {
            id: "venue-uk-n123",
            name: "Base Arms",
            address: "",
            lat: 53.8,
            lng: -1.55,
            curatedVenueId: "",
            kind: "pub",
          },
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: base,
        cityName: "UK",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain('aria-label="Listed pubs and venues"');
    expect(html).toContain('aria-label="Other pubs and bars with no listed price"');
    expect(html).toContain("Base Arms");
    expect(html).toContain("Other pub · no listed price");
  });

  it("offers Nearest and Cheapest sort chips when the list has venues", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
          sortPrice: 4.5,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
        sortMode: "cheapest",
        onSortModeChange: () => {},
      }),
    );

    expect(html).toContain('aria-label="Sort venues on the map"');
    expect(html).toContain("Nearest");
    expect(html).toContain("Cheapest");
    expect(html).toContain('aria-pressed="true"');
    const cheapest = html.match(/<button[^>]*>Cheapest<\/button>/)?.[0];
    expect(cheapest).toBeDefined();
    expect(cheapest).toContain('aria-pressed="true"');
    expect(cheapest).not.toContain("disabled");
  });

  it.each([null, "35ml"])("shows nearest order and disables Cheapest without comparable quotes for serving %s", (servingGroup) => {
    const curated: MapVenueListModel = {
      rows: [{ id: "venue-far", name: "Far Arms", typeLabel: "Pub",
        priceLabel: "£4.00", anchor: null, distanceKm: 0.8, sortPrice: null,
        lensPrice: { venueId: "venue-far", categoryLabel: "Gin", priceGbp: 4, source: "listed", category: "gin", drinkLabel: "Named gin",
          servingSize: "50ml", sourceUrl: "https://pub.example/menu", observedAt: "2026-09-24T12:00:00.000Z" } }],
      total: 2, shown: 1, truncated: true, coverageNote: null,
    };
    const base: UkBasePubListModel = {
      rows: [{ id: "venue-uk-near", name: "Near Arms", priceLabel: "Other pub · no listed price",
        distanceKm: 0.1, sortPrice: null,
        pub: { id: "venue-uk-near", name: "Near Arms", address: "", lat: 51.5, lng: -0.1,
          curatedVenueId: "", kind: "pub" } }],
      total: 1, shown: 1, truncated: false,
    };
    const html = renderToStaticMarkup(createElement(MapVenueList, {
      model: curated, ukBaseModel: base, cityName: "London", open: true,
      onOpenChange: () => {}, loaded: true, onSelectVenue: () => {},
      onSelectUkBasePub: () => {}, onPrefetchVenue: () => {},
      sortMode: "cheapest", onSortModeChange: () => {}, drinkCategory: "gin", servingGroup,
    }));

    const cheapest = html.match(/<button[^>]*>Cheapest<\/button>/)?.[0];
    const nearest = html.match(/<button[^>]*>Nearest<\/button>/)?.[0];
    expect(cheapest).toBeDefined();
    expect(cheapest).toContain('disabled=""');
    expect(cheapest).toContain('aria-pressed="false"');
    expect(nearest).toContain('aria-pressed="true"');
    expect(html).toContain("Nearest 2 of 3");
    expect(html).not.toContain("Cheapest 2 of 3");
    expect(html).toContain("Near Arms");
    expect(html).toContain("Far Arms");
    expect(html.indexOf("Near Arms")).toBeLessThan(html.indexOf("Far Arms"));
    expect(html).toMatch(/Named gin · 50ml · pub\.example · 24 Sept? 2026 · Unranked/);
  });

  it("keeps Cheapest available when one selected-serving quote can rank beside unranked offers", () => {
    const curated: MapVenueListModel = {
      rows: [{ id: "venue-near", name: "Near Unranked", typeLabel: "Pub",
        priceLabel: "£3.00", anchor: null, distanceKm: 0.1, sortPrice: null },
        { id: "venue-ranked", name: "Ranked Arms", typeLabel: "Pub", priceLabel: "£4.20",
          anchor: null, distanceKm: 0.8, sortPrice: 4.2,
          lensPrice: { venueId: "venue-ranked", categoryLabel: "Gin", priceGbp: 4.2, source: "listed", category: "gin", drinkLabel: "Named gin",
            servingSize: "25ml", sourceUrl: "https://pub.example/menu", observedAt: "2026-09-24T12:00:00.000Z" } }],
      total: 3, shown: 2, truncated: true, coverageNote: null,
    };
    const html = renderToStaticMarkup(createElement(MapVenueList, {
      model: curated, ukBaseModel: emptyBase, cityName: "London", open: true,
      onOpenChange: () => {}, loaded: true, onSelectVenue: () => {},
      onSelectUkBasePub: () => {}, onPrefetchVenue: () => {},
      sortMode: "cheapest", onSortModeChange: () => {}, drinkCategory: "gin", servingGroup: "25ml",
    }));

    const cheapest = html.match(/<button[^>]*>Cheapest<\/button>/)?.[0];
    const nearest = html.match(/<button[^>]*>Nearest<\/button>/)?.[0];
    expect(cheapest).toBeDefined();
    expect(cheapest).not.toContain("disabled");
    expect(cheapest).toContain('aria-pressed="true"');
    expect(nearest).toContain('aria-pressed="false"');
    expect(html).toContain("Cheapest 2 of 3");
    expect(html).toContain("Ranked Arms");
    expect(html).toContain("Near Unranked");
    expect(html.indexOf("Ranked Arms")).toBeLessThan(html.indexOf("Near Unranked"));
    expect(html).toMatch(/Named gin · 25ml · pub\.example · 24 Sept? 2026/);
  });

  it("keeps an empty list explicit and omits the sort chips", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
        sortMode: "nearest",
        onSortModeChange: () => {},
      }),
    );

    expect(html).toContain("Nothing matches");
    expect(html).toContain(
      "Nothing in view fits that, which takes some doing round here",
    );
    expect(html).not.toContain('aria-label="Sort venues on the map"');
  });

  it("does not claim an empty view when unlisted pubs could not load", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "unavailable",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Unlisted pubs could not load");
    expect(html).not.toContain("Nothing matches");
    expect(html).not.toContain("Nothing in view fits that");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("keeps an empty list pending while unlisted pubs are still loading", () => {
    const curated: MapVenueListModel = {
      rows: [],
      total: 0,
      shown: 0,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "loading",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Counting them up…");
    expect(html).not.toContain("Nothing matches");
    expect(html).not.toContain("Nothing in view fits that");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("discloses incomplete unlisted-pub coverage beside curated results", () => {
    const curated: MapVenueListModel = {
      rows: [
        {
          id: "venue-curated",
          name: "Curated Arms",
          typeLabel: "Pub",
          priceLabel: "£4.50",
          anchor: null,
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      coverageNote: null,
    };

    const html = renderToStaticMarkup(
      createElement(MapVenueList, {
        model: curated,
        ukBaseModel: emptyBase,
        ukBaseStatus: "unavailable",
        cityName: "London",
        open: true,
        onOpenChange: () => {},
        loaded: true,
        onSelectVenue: () => {},
        onSelectUkBasePub: () => {},
        onPrefetchVenue: () => {},
      }),
    );

    expect(html).toContain("Some unlisted pubs could not load");
    expect(html).toContain("Curated Arms");
  });
});


it("offers source-stated serving choices and an explicit unranked view", () => {
  const html = renderToStaticMarkup(createElement(DrinkLanePicker, {
    lane: "gin", status: "ready", onChange: () => {},
    servingGroups: ["25ml", "50ml"], servingGroup: "25ml", onServingGroupChange: () => {},
  }));
  expect(html).toContain('aria-label="Serving size for price comparison"');
  expect(html).toContain("25ml");
  expect(html).toContain("50ml");
  expect(html).toContain("Choose a serving size to compare menu prices.");
  expect(html).toContain("Other servings and community reports stay visible, unranked.");
  expect(html.match(/compare menu prices/g)).toHaveLength(1);
  expect(html).not.toContain("35ml");
});


describe("MapVenueList pages", () => {
  function curatedRows(count: number): MapVenueListModel {
    return {
      rows: Array.from({ length: count }, (_, index) => ({
        id: `venue-${index + 1}`, name: `Listed pub ${index + 1}`, typeLabel: "Pub",
        priceLabel: "Price TBD", anchor: null, distanceKm: index / 100, sortPrice: null,
      })),
      total: count, shown: count, truncated: false, coverageNote: null,
    };
  }

  function baseRows(count: number): UkBasePubListModel {
    return {
      rows: Array.from({ length: count }, (_, index) => {
        const pub = { id: `venue-uk-${index + 1}`, name: `Other pub ${index + 1}`,
          address: "", lat: 51.5, lng: -0.1, curatedVenueId: "", kind: "pub" as const };
        return { id: pub.id, name: pub.name, priceLabel: "Other pub · no listed price",
          distanceKm: (index + 100) / 100, pub, sortPrice: null };
      }),
      total: count, shown: count, truncated: false,
    };
  }

  const props = {
    cityName: "London", open: true, loaded: true,
    onOpenChange: vi.fn(), onSelectVenue: vi.fn(), onSelectUkBasePub: vi.fn(), onPrefetchVenue: vi.fn(),
  };
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render(extra: Partial<Parameters<typeof MapVenueList>[0]> = {}) {
    act(() => root.render(createElement(MapVenueList, { ...props, model: curatedRows(0), ukBaseModel: emptyBase, ...extra })));
    act(() => vi.runOnlyPendingTimers());
  }

  function venues() {
    return Array.from(host.querySelectorAll<HTMLButtonElement>("button[data-venue-id]"));
  }

  function pageButton(label: "Previous" | "Next") {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent === label);
    expect(button, `${label} page control`).toBeDefined();
    return button!;
  }

  function turnPage(label: "Previous" | "Next") {
    const button = pageButton(label);
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    act(() => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(venues()[0]);
  }

  it.each(["listed", "unlisted", "drink"] as const)("mounts only the first 60 of 65 %s results without claiming lost coverage", (kind) => {
    render({ model: curatedRows(kind === "unlisted" ? 0 : 65),
      ukBaseModel: kind === "unlisted" ? baseRows(65) : emptyBase,
      drinkCategory: kind === "drink" ? "gin" : null });
    expect(venues()).toHaveLength(60);
    expect(host.textContent).toContain("1-60 of 65");
    expect(host.textContent).not.toContain("Nearest 60 of 65");
    expect(pageButton("Previous").disabled).toBe(true);
    expect(pageButton("Next").disabled).toBe(false);
    expect(venues().some((button) => button.dataset.venueId?.endsWith("-65"))).toBe(false);
  });

  it("ranks a selected-serving offer beyond the first 60 input rows before choosing the first page", () => {
    const model = curatedRows(65);
    const cheapest = model.rows[64];
    cheapest.name = "Cheapest late candidate";
    cheapest.priceLabel = "£4.20";
    cheapest.sortPrice = 4.2;
    cheapest.lensPrice = { venueId: cheapest.id, categoryLabel: "Gin", priceGbp: 4.2, source: "listed", category: "gin",
      drinkLabel: "Named gin", servingSize: "25ml", sourceUrl: "https://pub.example/menu", observedAt: "2026-09-24T12:00:00.000Z" };
    render({ model, drinkCategory: "gin", servingGroup: "25ml", sortMode: "cheapest", onSortModeChange: vi.fn() });
    expect(venues()).toHaveLength(60);
    expect(venues()[0].dataset.venueId).toBe("venue-65");
    expect(venues()[0].textContent).toMatch(/Named gin · 25ml · pub\.example · 24 Sept? 2026/);
    expect(venues()[0].textContent).not.toContain("Unranked");
  });

  it("reaches every result across group boundaries, keeps exact base identity, and returns to the held page", () => {
    const model = curatedRows(65);
    const ukBaseModel = baseRows(65);
    render({ model, ukBaseModel });
    const seen = venues().map((button) => button.dataset.venueId);
    turnPage("Next");
    expect(venues()).toHaveLength(60);
    expect(host.textContent).toContain("61-120 of 130");
    expect(venues()[0].dataset.venueId).toBe("venue-61");
    seen.push(...venues().map((button) => button.dataset.venueId));
    turnPage("Next");
    expect(venues()).toHaveLength(10);
    expect(host.textContent).toContain("121-130 of 130");
    expect(pageButton("Next").disabled).toBe(true);
    seen.push(...venues().map((button) => button.dataset.venueId));
    expect(new Set(seen).size).toBe(130);
    const last = venues().at(-1)!;
    last.focus();
    act(() => last.click());
    expect(props.onSelectUkBasePub).toHaveBeenCalledWith(ukBaseModel.rows[64].pub);
    expect(props.onSelectUkBasePub.mock.calls[0][0]).toBe(ukBaseModel.rows[64].pub);
    expect(props.onSelectVenue).not.toHaveBeenCalled();
    render({ model, ukBaseModel });
    expect(host.textContent).toContain("121-130 of 130");
    turnPage("Previous");
    expect(venues()[0].dataset.venueId).toBe("venue-61");
    act(() => venues()[0].click());
    expect(props.onSelectVenue).toHaveBeenCalledWith("venue-61");
    turnPage("Previous");
    expect(venues()[0].dataset.venueId).toBe("venue-1");
    expect(pageButton("Previous").disabled).toBe(true);
    act(() => venues()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts at the first page after sort, category, serving, and a fresh open", () => {
    const model = curatedRows(65);
    const ukBaseModel = baseRows(0);
    const state = { model, ukBaseModel, drinkCategory: "gin" as const, servingGroup: "25ml", onSortModeChange: vi.fn() };
    render(state);
    turnPage("Next");
    render({ ...state, servingGroup: "50ml" });
    expect(venues()[0].dataset.venueId).toBe("venue-1");
    turnPage("Next");
    render({ ...state, drinkCategory: "wine" });
    expect(venues()[0].dataset.venueId).toBe("venue-1");
    turnPage("Next");
    render({ ...state, sortMode: "cheapest" });
    expect(venues()[0].dataset.venueId).toBe("venue-1");
    turnPage("Next");
    render({ ...state, open: false });
    expect(venues()).toHaveLength(0);
    render(state);
    expect(venues()[0].dataset.venueId).toBe("venue-1");
    expect(document.activeElement).toBe(venues()[0]);
  });

  it("keeps the remaining results reachable when an open later page loses rows", () => {
    render({ model: curatedRows(65) });
    turnPage("Next");
    render({ model: curatedRows(10) });
    expect(venues()).toHaveLength(10);
    expect(venues()[0].dataset.venueId).toBe("venue-1");
    expect(host.textContent).not.toContain("61-");
    expect(host.textContent).toContain("10 venues");
  });
});
