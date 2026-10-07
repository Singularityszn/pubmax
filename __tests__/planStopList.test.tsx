/** @vitest-environment jsdom */

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftStop } from "@/components/plan/PlanComposer";
import PlanStopList, { type PlanStopListProps } from "@/components/plan/PlanStopList";
import { moveItem } from "@/lib/planStopReorder";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

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

function pointer(type: string, target: EventTarget, init: { clientX?: number; clientY?: number }, pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
  });
  target.dispatchEvent(event);
}

describe("PlanStopList", () => {
  it("prints the route's area only on stops the generator placed there", async () => {
    await mount();
    const meta = cards().map((card) => card.querySelector(".planStop__meta")?.textContent ?? null);
    expect(meta).toEqual(["Clapham · Listed price", null, "Clapham · Listed price"]);
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
