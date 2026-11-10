/** @vitest-environment jsdom */

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftStop } from "@/components/plan/PlanComposer";
import PlanStopList, { type PlanStopListProps } from "@/components/plan/PlanStopList";
import { moveItem } from "@/lib/planStopReorder";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => String(input).startsWith("/api/pint-drops") ? { drops: [] } : { prices: [] },
  } as Response)));
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const generated: DraftStop = {
  key: 1,
  venueId: "venue-one",
  venueName: "The Windmill",
  reason: "Close to the heart of the area.",
  estimatedPintPricePence: 620,
  priceKind: "listed",
  alternatives: [],
};
const picked: DraftStop = { key: 2, venueId: "venue-two", venueName: "Holborn Arms", alternatives: [] };
const third: DraftStop = {
  ...generated,
  key: 3,
  venueId: "venue-three",
  venueName: "The Bread and Roses",
  walkingMinutesFromPrevious: 6,
  walkFromVenueId: "venue-two",
};

async function mount(overrides: Partial<PlanStopListProps> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const props: PlanStopListProps = {
    stops: [generated, picked, third],
    areaName: "Clapham",
    heldVenueId: null,
    measured: new Map(),
    venues: [],
    canAdd: true,
    refreshKey: 0,
    removable: true,
    swapLabel: (_stop, index) => `Swap stop ${index + 1}`,
    swapDisabled: () => true,
    removeLabel: (_stop, index) => `Remove stop ${index + 1}`,
    removeDisabled: () => false,
    onSwap: vi.fn(),
    onRemove: vi.fn(),
    onPick: vi.fn(),
    onReorder: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root!.render(createElement(PlanStopList, props));
  });
  return props;
}

function cards(): HTMLLIElement[] {
  return [...host!.querySelectorAll<HTMLLIElement>("li.planStop")];
}

function pointer(type: string, target: EventTarget, init: { clientX?: number; clientY?: number; timeStamp?: number }, pointerType = "mouse") {
  const { timeStamp, ...coords } = init;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...coords });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
    ...(timeStamp === undefined ? {} : { timeStamp: { value: timeStamp } }),
  });
  target.dispatchEvent(event);
}

const reduceMotion = () => vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));

async function swipe(card: HTMLElement, steps: Array<{ x: number; t: number }>, releaseAt: number) {
  const surface = card.querySelector<HTMLElement>(".planStop__surface")!;
  await act(async () => {
    pointer("pointerdown", surface, { clientX: 200, clientY: 10, timeStamp: 0 }, "touch");
    for (const step of steps) pointer("pointermove", surface, { clientX: step.x, clientY: 10, timeStamp: step.t }, "touch");
    pointer("pointerup", window, { clientX: steps.at(-1)!.x, clientY: 10, timeStamp: releaseAt }, "touch");
  });
}

describe("PlanStopList", () => {
  const unpricedStopProps: Partial<PlanStopListProps> = {
    stops: [picked],
    venues: [{ id: picked.venueId, name: picked.venueName, zone: 4, hasRecordedPrice: false }],
    zoneIndex: {
      rows: [{ zone: 4, medianGbp: 4.95, pricedCount: 66, enough: true }],
      ranked: [], dearest: null, cheapest: null, taxGbp: null, computedAt: "2026-11-10T00:00:00Z",
    },
  };

  it.each(["/api/pint-drops", "/api/price-submit"])("withholds a zone estimate when %s holds a public price", async (path) => {
    vi.mocked(fetch).mockImplementation(async (input) => ({
      ok: true,
      json: async () => String(input).startsWith("/api/pint-drops")
        ? { drops: path === "/api/pint-drops" ? [{ venueId: picked.venueId, priceGbp: 5.8 }] : [] }
        : { prices: path === "/api/price-submit" ? [{ venueId: picked.venueId, drinkCategory: "beer", priceGbp: 5.8 }] : [] },
    } as Response));
    await mount(unpricedStopProps);
    expect(host!.textContent).not.toContain("est. £4.95");
  });

  it.each(["/api/pint-drops", "/api/price-submit"])("waits for the selected stop's %s read", async (path) => {
    const emptyRead = vi.mocked(fetch).getMockImplementation()!;
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation((input) => String(input).startsWith(path)
      ? new Promise<Response>((done) => { resolve = done; }) : emptyRead(input));
    await mount(unpricedStopProps);
    expect(host!.textContent).not.toContain("est. £4.95");
    await act(async () => resolve({ ok: true, json: async () => path === "/api/pint-drops" ? { drops: [] } : { prices: [] } } as Response));
    expect(host!.textContent).toContain("est. £4.95");
  });

  it.each(["rejected", "non-ok", "degraded", "malformed", "malformed-row"])("withholds an estimate after a %s public price read", async (failure) => {
    vi.mocked(fetch).mockImplementation(async () => {
      if (failure === "rejected") throw new Error("offline");
      return {
        ok: failure !== "non-ok",
        json: async () => failure === "malformed" ? {} : {
          drops: failure === "malformed-row" ? [{}] : [], prices: [], degraded: failure === "degraded",
        },
      } as Response;
    });
    await mount(unpricedStopProps);
    expect(host!.textContent).not.toContain("est. £4.95");
  });

  it("checks public prices again when a stop returns to the plan", async () => {
    const props = await mount(unpricedStopProps);
    expect(host!.textContent).toContain("est. £4.95");
    await act(async () => root!.render(createElement(PlanStopList, { ...props, stops: [] })));
    vi.mocked(fetch).mockImplementation(async () => ({
      ok: true, json: async () => ({ drops: [{ priceGbp: 5.8 }], prices: [] }),
    } as Response));
    await act(async () => root!.render(createElement(PlanStopList, props)));
    expect(host!.textContent).not.toContain("est. £4.95");
  });

  it("keeps the current estimate when a removed stop's read completes", async () => {
    const answers: Array<(value: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((done) => { answers.push(done); }));
    const props = await mount(unpricedStopProps);
    vi.mocked(fetch).mockImplementation(async () => ({
      ok: true, json: async () => ({ drops: [], prices: [] }),
    } as Response));
    await act(async () => root!.render(createElement(PlanStopList, {
      ...props,
      stops: [{ ...picked, venueId: "another-pub" }],
      venues: [{ id: "another-pub", name: "Another Pub", zone: 4, hasRecordedPrice: false }],
    })));
    expect(host!.textContent).toContain("est. £4.95");
    await act(async () => {
      for (const answer of answers) answer({ ok: true, json: async () => ({ drops: [], prices: [] }) } as Response);
    });
    expect(host!.textContent).toContain("est. £4.95");
  });

  it("allows a pint estimate beside an unpriced story and a recorded wine price", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ drops: [{ priceGbp: null }], prices: [{ drinkCategory: "wine", priceGbp: 7 }] }),
    } as Response);
    await mount(unpricedStopProps);
    expect(host!.textContent).toContain("est. £4.95");
  });

  it.each([true, undefined])("withholds a chosen stop estimate when recorded-price availability is %s", async (hasRecordedPrice) => {
    await mount({
      stops: [picked],
      venues: [{ id: picked.venueId, name: picked.venueName, zone: 4, hasRecordedPrice }],
      zoneIndex: {
        rows: [{ zone: 4, medianGbp: 4.95, pricedCount: 66, enough: true }],
        ranked: [], dearest: null, cheapest: null, taxGbp: null,
        computedAt: "2026-11-10T00:00:00Z",
      },
    });
    expect(host!.textContent).not.toContain("est. £4.95");
    expect(host!.textContent).not.toContain("Zone 4 estimate");
  });

  it("estimates a manually chosen stop after confirmed price absence", async () => {
    await mount({
      stops: [picked],
      venues: [{ id: picked.venueId, name: picked.venueName, zone: 4, hasRecordedPrice: false }],
      zoneIndex: {
        rows: [{ zone: 4, medianGbp: 4.95, pricedCount: 66, enough: true }],
        ranked: [], dearest: null, cheapest: null, taxGbp: null, computedAt: "2026-11-10T00:00:00Z",
      },
    });
    expect(host!.textContent).toContain("est. £4.95");
  });

  it.each(["", "   "])("shows an unnamed accepted venue as a card, never a finder (%j)", async (venueName) => {
    const accepted: DraftStop = { key: 1, venueId: "venue-uk-unindexed", venueName, alternatives: [] };
    const props = await mount({ stops: [accepted, picked], heldVenueId: accepted.venueId, swapDisabled: () => false });
    const card = cards()[0]!;
    expect(card.querySelector(".planStop__find")).toBeNull();
    expect(card.querySelector(".planStop__name")?.textContent).toBe("Your chosen place");
    await act(async () => {
      card.querySelector<HTMLButtonElement>(".planStop__swap")!.click();
    });
    expect(props.onSwap).toHaveBeenCalledWith(1);
  });

  it("shows an unnamed venue that is no longer held as a pub finder", async () => {
    const released: DraftStop = { key: 1, venueId: "venue-uk-unindexed", venueName: "", alternatives: [] };
    await mount({ stops: [released, picked], heldVenueId: null });
    expect(cards()[0]!.querySelector(".planStop__open")).toBeNull();
    expect(cards()[0]!.querySelector(".planStop__find")?.getAttribute("aria-label")).toBe("Find a pub for stop 1");
  });

  it("does not swipe open a tray on a route with nothing to remove", async () => {
    await mount({ stops: [generated], removable: false });
    const surface = cards()[0]!.querySelector<HTMLElement>(".planStop__surface")!;
    await act(async () => {
      pointer("pointerdown", surface, { clientX: 200, clientY: 10 }, "touch");
      pointer("pointermove", surface, { clientX: 150, clientY: 10 }, "touch");
      pointer("pointermove", surface, { clientX: 60, clientY: 10 }, "touch");
      pointer("pointerup", window, { clientX: 60, clientY: 10 }, "touch");
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(cards()[0]!.dataset.revealed).toBeUndefined();
    expect(surface.style.transform).toBe("");
  });

  it("returns the other cards to their places when a drag is cancelled", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const li = this.closest("li");
      const index = li?.parentElement ? [...li.parentElement.children].indexOf(li) : 0;
      return { top: index * 80, height: 72, bottom: index * 80 + 72, left: 0, right: 300, width: 300, x: 0, y: index * 80, toJSON: () => ({}) } as DOMRect;
    });
    await mount();
    const surface = cards()[1]!.querySelector<HTMLElement>(".planStop__surface")!;
    await act(async () => {
      pointer("pointerdown", surface, { clientX: 10, clientY: 100 });
      pointer("pointermove", surface, { clientX: 10, clientY: 190 });
    });
    expect(cards()[2]!.style.transform).not.toBe("");
    pointer("pointercancel", window, { clientX: 10, clientY: 190 });
    expect(cards()[1]!.dataset.dragRole).toBe("lifted");
    expect(cards()[2]!.style.transform).toBe("");
  });

  it("never swipes a held first stop open onto a Remove it cannot use", async () => {
    reduceMotion();
    const held: DraftStop = { ...generated, venueId: "venue-held" };
    await mount({ stops: [held, picked], heldVenueId: held.venueId, removeDisabled: (_stop, index) => index === 0 });
    await swipe(cards()[0]!, [{ x: 180, t: 10 }, { x: 60, t: 20 }], 30);
    expect(cards()[0]!.dataset.revealed).toBeUndefined();
  });

  it("closes an open tray once nothing is left to remove", async () => {
    reduceMotion();
    const props = await mount({ stops: [generated, picked] });
    await swipe(cards()[0]!, [{ x: 180, t: 10 }, { x: 60, t: 20 }], 30);
    expect(cards()[0]!.dataset.revealed).toBe("true");
    await act(async () => {
      root!.render(createElement(PlanStopList, { ...props, stops: [generated], removable: false }));
    });
    expect(cards()[0]!.dataset.revealed).toBeUndefined();
  });

  it("does not open a tray again by itself when a stop is added after a remove", async () => {
    reduceMotion();
    const empty: DraftStop = { key: 2, venueId: "", venueName: "", alternatives: [] };
    const added: DraftStop = { key: 3, venueId: "", venueName: "", alternatives: [] };
    const props = await mount({ stops: [generated, empty] });
    await swipe(cards()[0]!, [{ x: 180, t: 10 }, { x: 60, t: 20 }], 30);
    expect(cards()[0]!.dataset.revealed).toBe("true");
    await act(async () => {
      root!.render(createElement(PlanStopList, { ...props, stops: [generated], removable: false }));
    });
    await act(async () => {
      root!.render(createElement(PlanStopList, { ...props, stops: [generated, added], removable: true }));
    });
    expect(cards()[0]!.dataset.revealed).toBeUndefined();
  });

  it("does not open a tray again by itself when its stop is locked and then unlocked", async () => {
    reduceMotion();
    const props = await mount({ stops: [generated, picked] });
    await swipe(cards()[0]!, [{ x: 180, t: 10 }, { x: 60, t: 20 }], 30);
    expect(cards()[0]!.dataset.revealed).toBe("true");
    await act(async () => {
      root!.render(createElement(PlanStopList, { ...props, removeDisabled: (_stop, index) => index === 0 }));
    });
    expect(cards()[0]!.dataset.revealed).toBeUndefined();
    await act(async () => {
      root!.render(createElement(PlanStopList, { ...props, removeDisabled: () => false }));
    });
    expect(cards()[0]!.dataset.revealed).toBeUndefined();
  });

  it.each([1, 0])("moves focus into the finder a Swap leaves behind (click detail %i)", async (detail) => {
    const unnamed: DraftStop = { key: 1, venueId: "venue-uk-unindexed", venueName: "", alternatives: [] };
    const props = await mount({ stops: [unnamed, picked], heldVenueId: unnamed.venueId, swapDisabled: () => false });
    await act(async () => {
      cards()[0]!.querySelector<HTMLButtonElement>(".planStop__swap")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
    });
    expect(props.onSwap).toHaveBeenCalledWith(1);
    await act(async () => {
      root!.render(createElement(PlanStopList, {
        ...props,
        heldVenueId: null,
        stops: [{ key: 1, venueId: "", venueName: "", alternatives: [] }, picked],
      }));
    });
    expect(document.activeElement).toBe(cards()[0]!.querySelector(".planStop__find"));
  });

  it("ignores a mouse that keeps moving while a dropped card settles", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const li = this.closest("li");
      const index = li?.parentElement ? [...li.parentElement.children].indexOf(li) : 0;
      return { top: index * 80, height: 72, bottom: index * 80 + 72, left: 0, right: 300, width: 300, x: 0, y: index * 80, toJSON: () => ({}) } as DOMRect;
    });
    await mount();
    const surface = cards()[0]!.querySelector<HTMLElement>(".planStop__surface")!;
    await act(async () => {
      pointer("pointerdown", surface, { clientX: 10, clientY: 10, timeStamp: 0 });
      pointer("pointermove", surface, { clientX: 10, clientY: 100, timeStamp: 10 });
      pointer("pointerup", window, { clientX: 10, clientY: 100, timeStamp: 20 });
    });
    const neighbour = cards()[1]!.style.transform;
    pointer("pointermove", surface, { clientX: 10, clientY: 400, timeStamp: 30 });
    expect(cards()[0]!.style.transform).not.toBe("translate3d(0, 390px, 0)");
    expect(cards()[1]!.style.transform).toBe(neighbour);
    const scroll = new Event("touchmove", { bubbles: true, cancelable: true });
    surface.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it("hands focus to the card a keyboard pick turns the finder into", async () => {
    const venue = { id: "venue-anchor", name: "The Anchor" };
    const empty: DraftStop = { key: 4, venueId: "", venueName: "", alternatives: [] };
    const props = await mount({ stops: [generated, empty], venues: [venue] });
    const finder = host!.querySelector<HTMLInputElement>(".planStop__find")!;
    finder.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "The Ancho");
      finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      finder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(props.onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(finder);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "The Anchor");
      finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      finder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(props.onPick).toHaveBeenCalledWith(4, venue);
    await act(async () => {
      root!.render(createElement(PlanStopList, {
        ...props,
        stops: [generated, { key: 4, venueId: venue.id, venueName: venue.name, alternatives: [] }],
      }));
    });
    expect(document.activeElement).toBe(cards()[1]!.querySelector(".planStop__open"));
  });

  it("lets a quick swipe that came to rest before lifting settle shut", async () => {
    reduceMotion();
    await mount({ stops: [generated, picked] });
    await swipe(cards()[0]!, [{ x: 190, t: 10 }, { x: 175, t: 15 }, { x: 160, t: 20 }], 400);
    expect(cards()[0]!.dataset.revealed).toBeUndefined();
  });

  it("gives a mouse with no swipe a button that slides the card over to show Remove, and a click on the card shuts it", async () => {
    const held: DraftStop = { ...generated, venueId: "venue-held" };
    await mount({ stops: [held, picked], heldVenueId: held.venueId, removeDisabled: (_stop, index) => index === 0 });
    // The held pub cannot be removed, so it has nothing to show.
    expect(cards()[0]!.querySelector(".planStop__more")).toBeNull();
    const more = cards()[1]!.querySelector<HTMLButtonElement>(".planStop__more")!;
    expect(more.getAttribute("aria-label")).toBe("Show Remove for stop 2");
    expect(more.getAttribute("aria-expanded")).toBe("false");

    await act(async () => more.click());
    expect(cards()[1]!.dataset.revealed).toBe("true");
    expect(more.getAttribute("aria-expanded")).toBe("true");

    await act(async () => cards()[1]!.querySelector<HTMLElement>(".planStop__open")!.click());
    expect(cards()[1]!.dataset.revealed).toBeUndefined();
  });

  it("moves focus to the neighbour only when the keyboard removed the stop", async () => {
    const empty: DraftStop = { key: 4, venueId: "", venueName: "", alternatives: [] };
    const press = async (detail: number) => {
      const props = await mount({ stops: [generated, empty, third] });
      await act(async () => {
        cards()[0]!.querySelector<HTMLButtonElement>(".planStop__remove")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
      });
      expect(props.onRemove).toHaveBeenCalledWith(1);
      await act(async () => {
        root!.render(createElement(PlanStopList, { ...props, stops: [empty, third] }));
      });
      const focused = document.activeElement === host!.querySelector(".planStop__find");
      await act(async () => root!.unmount());
      root = null;
      host!.remove();
      return focused;
    };
    expect(await press(1)).toBe(false);
    expect(await press(0)).toBe(true);
  });

  it("announces only the keys that will do something on each card", async () => {
    const held: DraftStop = { ...generated, venueId: "venue-held" };
    await mount({ stops: [held, picked, third], heldVenueId: held.venueId, removeDisabled: (_stop, index) => index === 0 });
    const link = (index: number) => cards()[index]!.querySelector(".planStop__open")!;
    expect(link(0).getAttribute("aria-keyshortcuts")).toBeNull();
    expect(link(0).getAttribute("aria-description")).toBeNull();
    expect(link(1).getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowDown Delete Backspace");
    expect(link(2).getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowUp Delete Backspace");
    await act(async () => root!.unmount());
    root = null;
    host!.remove();
    await mount({ stops: [generated], removable: false });
    expect(link(0).getAttribute("aria-keyshortcuts")).toBeNull();
    expect(link(0).getAttribute("aria-description")).toBeNull();
  });

  it("holds the page still during a touch drag from a listener that was there before the touch", async () => {
    const added = vi.spyOn(HTMLOListElement.prototype, "addEventListener");
    await mount();
    expect(added).toHaveBeenCalledWith("touchmove", expect.any(Function), { passive: false });
    const surface = cards()[1]!.querySelector<HTMLElement>(".planStop__surface")!;
    const move = () => {
      const event = new Event("touchmove", { bubbles: true, cancelable: true });
      surface.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(move()).toBe(false);
    vi.useFakeTimers();
    await act(async () => {
      pointer("pointerdown", surface, { clientX: 10, clientY: 10 }, "touch");
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();
    expect(cards()[1]!.dataset.lifted).toBe("true");
    expect(move()).toBe(true);
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    surface.querySelector(".planStop__open")!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it("leaves a mouse's link menu alone", async () => {
    await mount();
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    cards()[1]!.querySelector(".planStop__open")!.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("prints the route's area only on stops the generator placed there", async () => {
    await mount();
    const meta = cards().map((card) => card.querySelector(".planStop__meta")?.textContent ?? null);
    expect(meta).toEqual(["Clapham · Listed price", null, "Clapham · Listed price"]);
  });

  it("shows the selected serving, publisher and full London source-read day beside its price", async () => {
    await mount({ stops: [{
      ...generated,
      venueName: "The Beehive",
      estimatedPintPricePence: 289,
      pintPriceEvidence: {
        venueId: generated.venueId, pence: 289, serving: "pint",
        source: { label: "Pint Prices", url: "https://pint-prices.com/", observedAt: "2026-10-01T23:30:00.000Z" },
      },
    }] });
    const card = cards()[0]!;
    expect(card.querySelector(".planStop__price")?.textContent).toBe("£2.89");
    expect(card.querySelector(".planStop__price")?.classList.contains("priceBand-cheap")).toBe(true);
    expect(card.querySelector(".planStop__meta")?.textContent).toContain("Listed pint price");
    expect(card.querySelector("small")?.textContent).toBe("1 pint · Pint Prices · Source read 2 October 2026");
    expect(card.querySelector('a[href="https://pint-prices.com/"]')?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a named publisher without an unsafe link, and marks an estimate's evidence as missing", async () => {
    const evidence = {
      venueId: generated.venueId, pence: 620, serving: null,
      source: { label: "Pub menu", url: null, observedAt: null },
    };
    await mount({ stops: [
      { ...generated, pintPriceEvidence: evidence },
      { ...third, priceKind: "estimated", pintPriceEvidence: evidence },
    ] });
    expect(cards()[0]!.querySelector("small")?.textContent).toBe(
      "Serving size not recorded · Pub menu · Link unavailable · Source read date unknown",
    );
    expect(cards()[0]!.querySelector("small a")).toBeNull();
    expect(cards()[0]!.querySelector(".planStop__price")?.className).toBe("planStop__price");
    expect(cards()[0]!.querySelector(".planStop__meta")?.textContent).toBe("Clapham · Listed price");
    expect(cards()[1]!.querySelector(".planStop__meta")?.textContent).toBe("Clapham · Estimated price");
    expect(cards()[1]!.querySelector(".planStop__price")?.className).toBe("planStop__price");
    expect(cards()[1]!.querySelector("small")?.textContent).toBe(
      "Serving size not recorded · Publisher not recorded · Source read date unknown",
    );
  });

  it("keeps the amount in neutral ink when the same price belongs to another pub", async () => {
    await mount({ stops: [{
      ...generated,
      pintPriceEvidence: {
        venueId: "another-pub", pence: 620, serving: "pint",
        source: { label: "Another pub menu", url: "https://example.com/another", observedAt: "2026-10-02" },
      },
    }] });
    const card = cards()[0]!;
    expect(card.querySelector(".planStop__price")?.textContent).toBe("£6.20");
    expect(card.querySelector(".planStop__price")?.className).toBe("planStop__price");
    expect(card.querySelector("small")?.textContent).toBe(
      "Serving size not recorded · Publisher not recorded · Source read date unknown",
    );
  });

  it("prints the area on an unpriced first stop the generator placed", async () => {
    const unpriced: DraftStop = { key: 1, venueId: "venue-one", venueName: "The Windmill", reason: "Close to the heart of the area.", alternatives: [] };
    await mount({ stops: [unpriced, picked] });
    const meta = cards().map((card) => card.querySelector(".planStop__meta")?.textContent ?? null);
    expect(meta).toEqual(["Clapham", null]);
  });

  it("removes a focused stop with Backspace as well as Delete", async () => {
    const props = await mount();
    const links = cards().map((card) => card.querySelector<HTMLElement>(".planStop__open")!);
    await act(async () => {
      links[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
      links[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    expect(props.onRemove).toHaveBeenNthCalledWith(1, 2);
    expect(props.onRemove).toHaveBeenNthCalledWith(2, 3);
  });

  it("still lifts a card after a mouse press was released off its card", async () => {
    await mount();
    const surfaces = cards().map((card) => card.querySelector<HTMLElement>(".planStop__surface")!);
    await act(async () => {
      pointer("pointerdown", surfaces[0]!, { clientX: 10, clientY: 10 });
      pointer("pointerup", document.body, { clientX: 10, clientY: 400 });
    });
    await act(async () => {
      pointer("pointerdown", surfaces[2]!, { clientX: 10, clientY: 10 });
      pointer("pointermove", surfaces[2]!, { clientX: 10, clientY: 30 });
    });
    expect(cards()[2]!.dataset.lifted).toBe("true");
  });

  it("measures only the cards still on the list after one is removed", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      return { top: index * 80, height: 72, bottom: index * 80 + 72, left: 0, right: 300, width: 300, x: 0, y: index * 80, toJSON: () => ({}) } as DOMRect;
    });
    const props = await mount();
    await act(async () => {
      root!.render(createElement(PlanStopList, { ...props, stops: [generated, picked] }));
    });
    const surface = cards()[0]!.querySelector<HTMLElement>(".planStop__surface")!;
    await act(async () => {
      pointer("pointerdown", surface, { clientX: 10, clientY: 10 });
      pointer("pointermove", surface, { clientX: 10, clientY: 17 });
      pointer("pointerup", surface, { clientX: 10, clientY: 17 });
    });
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("waits for a chosen pub instead of taking the first name typed out", async () => {
    const venues = [
      { id: "anchor", name: "Anchor" },
      { id: "bankside", name: "Anchor - Bankside" },
      { id: "lion-hillingdon", name: "Red Lion", borough: "Hillingdon" },
      { id: "lion-soho", name: "Red Lion", borough: "Westminster" },
      { id: "lion-mayfair", name: "Red Lion", borough: "Westminster" },
    ];
    const empty: DraftStop = { key: 4, venueId: "", venueName: "", alternatives: [] };
    const props = await mount({ stops: [generated, empty], venues });
    const finder = host!.querySelector<HTMLInputElement>(".planStop__find")!;
    const enter = async (value: string, inputType: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, value);
        finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
      });
    };

    await enter("Anchor", "insertText");
    expect(props.onPick).not.toHaveBeenCalled();

    const options = [...host!.querySelectorAll("#plan-venue-options option")].map((option) => option.getAttribute("value"));
    expect(options).toEqual([
      "Anchor",
      "Anchor - Bankside",
      "Red Lion, Hillingdon",
      "Red Lion, Westminster (1)",
      "Red Lion, Westminster (2)",
    ]);

    await enter("Red Lion", "insertText");
    await act(async () => {
      finder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(props.onPick).not.toHaveBeenCalled();

    await enter("Red Lion, Westminster (2)", "insertReplacementText");
    expect(props.onPick).toHaveBeenCalledWith(4, venues[4]);

    await enter("Anchor", "insertText");
    await act(async () => {
      finder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(props.onPick).toHaveBeenLastCalledWith(4, venues[0]);
  });

  it("closes a swiped-open Remove when a new route arrives", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    const props = await mount();
    const surface = cards()[1]!.querySelector<HTMLElement>(".planStop__surface")!;
    await act(async () => {
      pointer("pointerdown", surface, { clientX: 200, clientY: 10 }, "touch");
      pointer("pointermove", surface, { clientX: 80, clientY: 12 }, "touch");
      pointer("pointerup", surface, { clientX: 80, clientY: 12 }, "touch");
    });
    expect(cards()[1]!.dataset.revealed).toBe("true");

    await act(async () => {
      root!.render(createElement(PlanStopList, { ...props, refreshKey: 1 }));
    });
    expect(cards().some((card) => card.dataset.revealed)).toBe(false);
  });

  it("lets a half-filled finder row be removed without choosing the typed pub", async () => {
    const venues = [{ id: "anchor", name: "Anchor" }];
    const empty: DraftStop = { key: 4, venueId: "", venueName: "", alternatives: [] };
    const props = await mount({ stops: [generated, empty], venues });
    const finder = host!.querySelector<HTMLInputElement>(".planStop__find")!;
    finder.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "Anchor");
      finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    });
    const drop = host!.querySelector<HTMLButtonElement>(".planStop__drop")!;
    await act(async () => {
      drop.focus();
      drop.click();
    });
    expect(props.onPick).not.toHaveBeenCalled();
    expect(props.onRemove).toHaveBeenCalledWith(4);
  });

  it("keeps keyboard focus on a moved stop, and on the neighbour of a removed one", async () => {
    function Harness() {
      const [stops, setStops] = useState<DraftStop[]>([generated, picked, third]);
      return createElement(PlanStopList, {
        stops,
        areaName: null,
        heldVenueId: null,
        measured: new Map(),
        venues: [],
        canAdd: true,
        refreshKey: 0,
        removable: true,
        swapLabel: () => "Swap",
        swapDisabled: () => true,
        removeLabel: () => "Remove",
        removeDisabled: () => false,
        onSwap: () => undefined,
        onRemove: (key: number) => setStops((current) => current.filter((stop) => stop.key !== key)),
        onPick: () => undefined,
        onReorder: (from: number, to: number) => setStops((current) => moveItem(current, from, to)),
        onAdd: () => undefined,
      });
    }
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(Harness)));
    const link = (key: number) => host!.querySelector<HTMLElement>(`[data-stop-key="${key}"] .planStop__open`)!;

    link(1).focus();
    await act(async () => {
      link(1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true }));
    });
    expect(cards().map((card) => card.dataset.stopKey)).toEqual(["2", "1", "3"]);
    expect(document.activeElement).toBe(link(1));

    await act(async () => {
      link(1).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    expect(cards().map((card) => card.dataset.stopKey)).toEqual(["2", "3"]);
    expect(document.activeElement).toBe(link(3));
  });
});
