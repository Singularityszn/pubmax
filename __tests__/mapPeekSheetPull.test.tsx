// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapPeekSheet from "@/components/mobile/MapPeekSheet";
import type { MapPeekModel } from "@/lib/mapPeek";

const ANSWER: MapPeekModel = {
  status: "answer",
  answer: {
    venueId: "venue-1",
    name: "The Three Tuns",
    priceGbp: 2.95,
    priceLabel: "£2.95",
    anchor: null,
    isPub: true,
    lineLabel: null,
    figureLabel: "£2.95",
    walkMinutes: null,
  },
};

let container: HTMLDivElement;
let root: Root | null = null;

function pointerEvent(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
    isPrimary: { value: true },
    button: { value: 0 },
    clientX: { value: 100 },
    clientY: { value: clientY },
  });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a pull that opens the list", () => {
  it("sends the card home in the same step, so it is not parked mid-pull once the list closes", () => {
    const onOpenList = vi.fn();
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(MapPeekSheet, { model: ANSWER, onOpenVenue: vi.fn(), onOpenList }),
      );
    });
    const card = container.querySelector<HTMLElement>(".mapPeek")!;

    act(() => {
      card.dispatchEvent(pointerEvent("pointerdown", 500));
      card.dispatchEvent(pointerEvent("pointermove", 460));
      card.dispatchEvent(pointerEvent("pointermove", 420));
    });
    expect(card.style.transform).toBe("translate3d(0, -80px, 0)");
    expect(card.dataset.dragging).toBe("true");

    act(() => {
      card.dispatchEvent(pointerEvent("pointerup", 420));
    });
    expect(onOpenList).toHaveBeenCalledTimes(1);
    expect(card.style.transform).toBe("");
    expect(card.dataset.dragging).toBeUndefined();
  });
});

describe("an interrupted return", () => {
  function returningCard(distance = 30) {
    const onOpenList = vi.fn();
    root = createRoot(container);
    act(() => root!.render(createElement(MapPeekSheet, {
      model: ANSWER, onOpenVenue: vi.fn(), onOpenList,
    })));
    const card = container.querySelector<HTMLElement>(".mapPeek")!;
    act(() => {
      card.dispatchEvent(pointerEvent("pointerdown", 500));
      card.dispatchEvent(pointerEvent("pointermove", 470));
      card.dispatchEvent(pointerEvent("pointermove", 500 - distance));
      vi.advanceTimersByTime(100);
      card.dispatchEvent(pointerEvent("pointercancel", 500 - distance));
      vi.advanceTimersByTime(32);
    });
    return { card, onOpenList };
  }

  for (const release of ["pointerup", "pointercancel"]) {
    for (const distance of [30, -30]) {
      it(`returns home after an inactive ${release} interrupts a ${distance}px gesture`, () => {
        const { card, onOpenList } = returningCard(distance);
        expect(card.style.transform).not.toBe("");
        act(() => {
          card.dispatchEvent(pointerEvent("pointerdown", 470));
          card.dispatchEvent(pointerEvent(release, 470));
          vi.advanceTimersByTime(2000);
        });
        expect(card.style.transform).toBe("");
        expect(card.dataset.dragging).toBeUndefined();
        expect(onOpenList).not.toHaveBeenCalled();
      });
    }
  }

  for (const distance of [30, 200, -30]) {
    it(`resumes from a presented ${distance}px gesture without jumping`, () => {
      const { card, onOpenList } = returningCard(distance);
      const offset = () => Number(card.style.transform.match(/, ([-\d.]+)px/)?.[1] ?? 0);
      const origin = offset();
      act(() => {
        card.dispatchEvent(pointerEvent("pointerdown", 470));
        card.dispatchEvent(pointerEvent("pointermove", 460));
      });
      expect(offset()).toBeLessThan(origin);
      expect(origin - offset()).toBeLessThanOrEqual(10.01);
      act(() => {
        card.dispatchEvent(pointerEvent("pointermove", 500));
      });
      expect(offset()).toBeGreaterThan(origin);
      act(() => {
        card.dispatchEvent(pointerEvent("pointercancel", 500));
        vi.advanceTimersByTime(2000);
      });
      expect(card.style.transform).toBe("");
      expect(card.dataset.dragging).toBeUndefined();
      expect(onOpenList).not.toHaveBeenCalled();
    });
  }
});
