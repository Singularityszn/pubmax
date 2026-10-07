/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DraftStop } from "@/components/plan/PlanComposer";
import PlanStopList, { type PlanStopListProps } from "@/components/plan/PlanStopList";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

const generated: DraftStop = {
  key: 1,
  venueId: "venue-one",
  venueName: "The Windmill",
  walkingMinutesFromPrevious: null,
  estimatedPintPricePence: 620,
  priceKind: "listed",
  alternatives: [],
};
const picked: DraftStop = { key: 2, venueId: "venue-two", venueName: "Holborn Arms", alternatives: [] };
const third: DraftStop = { ...generated, key: 3, venueId: "venue-three", venueName: "The Bread and Roses" };

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

function pointer(type: string, target: EventTarget, init: { clientX?: number; clientY?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
  });
  target.dispatchEvent(event);
}

describe("PlanStopList", () => {
  it("prints the route's area only on stops the generator placed there", async () => {
    await mount();
    const meta = cards().map((card) => card.querySelector(".planStop__meta")?.textContent ?? null);
    expect(meta).toEqual(["Clapham · Listed price", null, "Clapham · Listed price"]);
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
});
