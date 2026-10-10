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

describe("a pull whose answer changes", () => {
  let capture: Element | null;
  const captureMethods = ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"] as const;
  let originalMethods: Array<PropertyDescriptor | undefined>;
  let originalElementFromPoint: PropertyDescriptor | undefined;

  beforeEach(() => {
    capture = null;
    originalMethods = captureMethods.map((name) => Object.getOwnPropertyDescriptor(Element.prototype, name));
    originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperties(Element.prototype, {
      setPointerCapture: {
        configurable: true,
        value: function (this: Element) {
          const previous = capture;
          capture = this;
          if (previous && previous !== this) previous.dispatchEvent(pointerEvent("lostpointercapture", 480));
        },
      },
      hasPointerCapture: { configurable: true, value: function (this: Element) { return capture === this; } },
      releasePointerCapture: {
        configurable: true,
        value: function (this: Element) {
          if (capture !== this) return;
          capture = null;
          this.dispatchEvent(pointerEvent("lostpointercapture", 420));
        },
      },
    });
  });

  afterEach(() => {
    captureMethods.forEach((name, index) => {
      const original = originalMethods[index];
      if (original) Object.defineProperty(Element.prototype, name, original);
      else Reflect.deleteProperty(Element.prototype, name);
    });
    if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
    else Reflect.deleteProperty(document, "elementFromPoint");
  });

  function routePointer(type: string, clientY: number) {
    if (capture && !capture.isConnected) {
      capture = null;
      document.dispatchEvent(pointerEvent("lostpointercapture", clientY));
    }
    (capture ?? document).dispatchEvent(pointerEvent(type, clientY));
  }

  for (const quiet of ["loading", "none", "unread", "partial"] as const) {
    for (const fromAnswer of [false, true]) {
      for (const initialMove of [0, 4, 20]) {
        for (const release of ["pointerup", "pointercancel", "lostpointercapture"]) {
          it(`${release} completes outside the card after ${fromAnswer ? "answer to" : "from"} ${quiet} at ${initialMove}px`, () => {
            const onOpenList = vi.fn();
            const onOpenVenue = vi.fn();
            root = createRoot(container);
            const render = (model: MapPeekModel) => act(() => root!.render(createElement(MapPeekSheet, {
              model, onOpenVenue, onOpenList,
            })));
            render(fromAnswer ? ANSWER : { status: quiet });
            const card = container.querySelector<HTMLElement>(".mapPeek")!;
            const start = container.querySelector<HTMLElement>(fromAnswer ? ".mapPeekPrice" : ".mapPeekLine span:last-child")!;
            act(() => {
              start.dispatchEvent(pointerEvent("pointerdown", 500));
              routePointer("pointermove", 500 - initialMove);
            });
            expect(card.style.transform).toBe(initialMove === 20 ? "translate3d(0, -20px, 0)" : "");
            render(fromAnswer ? { status: quiet } : ANSWER);
            act(() => {
              routePointer("pointermove", 420);
              const clickTarget = capture ?? card;
              routePointer(release, 420);
              clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
              vi.advanceTimersByTime(2000);
            });
            expect(onOpenList).toHaveBeenCalledTimes(release === "pointerup" ? 1 : 0);
            expect(onOpenVenue).not.toHaveBeenCalled();
            expect(card.style.transform).toBe("");
            expect(card.dataset.dragging).toBeUndefined();
          });
        }
      }
    }
  }

  for (const quiet of ["loading", "none", "unread", "partial"] as const) {
    for (const distance of [30, -30]) {
      for (const release of ["pointerup", "pointercancel", "lostpointercapture"]) {
        it(`settles an interrupted ${distance}px return after answer to ${quiet} and inactive ${release}`, () => {
          const onOpenList = vi.fn();
          const onOpenVenue = vi.fn();
          root = createRoot(container);
          const render = (model: MapPeekModel) => act(() => root!.render(createElement(MapPeekSheet, {
            model, onOpenVenue, onOpenList,
          })));
          render(ANSWER);
          const card = container.querySelector<HTMLElement>(".mapPeek")!;
          act(() => {
            card.dispatchEvent(pointerEvent("pointerdown", 500));
            routePointer("pointermove", 470);
            routePointer("pointermove", 500 - distance);
            vi.advanceTimersByTime(100);
            routePointer("pointerup", 500 - distance);
            vi.advanceTimersByTime(32);
          });
          const returningTransform = card.style.transform;
          expect(returningTransform).not.toBe("");
          act(() => {
            container.querySelector(".mapPeekPrice")!.dispatchEvent(pointerEvent("pointerdown", 470));
            routePointer("pointermove", 466);
          });
          expect(card.style.transform).toBe(returningTransform);
          render({ status: quiet });
          act(() => {
            routePointer(release, 466);
            vi.advanceTimersByTime(2000);
          });
          expect(onOpenList).not.toHaveBeenCalled();
          expect(onOpenVenue).not.toHaveBeenCalled();
          expect(card.style.transform).toBe("");
          expect(card.dataset.dragging).toBeUndefined();
        });
      }
    }
  }

  for (const control of ["answer", "list", "plan"] as const) {
    for (const release of ["inside", "outside", "cancelled", "dragged"] as const) {
      it(`${control} activates once only for a completed press inside (${release})`, () => {
        const onOpenList = vi.fn();
        const onOpenVenue = vi.fn();
        const onPlan = vi.fn();
        root = createRoot(container);
        act(() => root!.render(createElement(MapPeekSheet, {
          model: ANSWER, onOpenVenue, onOpenList,
        }, createElement("button", { className: "plan", onClick: onPlan }, createElement("strong", null, "Plan")))));
        const card = container.querySelector<HTMLElement>(".mapPeek")!;
        const button = container.querySelector<HTMLButtonElement>(
          control === "answer" ? ".mapPeekAnswer" : control === "list" ? ".mapPeekList" : ".plan",
        )!;
        const hit = release === "outside" ? document.body : button.firstElementChild;
        Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit });
        act(() => {
          button.firstElementChild!.dispatchEvent(pointerEvent("pointerdown", 500));
          if (release === "dragged") routePointer("pointermove", 480);
          vi.advanceTimersByTime(100);
          const clickTarget = capture ?? button;
          routePointer(release === "cancelled" ? "pointercancel" : "pointerup", release === "dragged" ? 480 : 500);
          clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
          vi.advanceTimersByTime(2000);
        });
        expect(onOpenVenue).toHaveBeenCalledTimes(control === "answer" && release === "inside" ? 1 : 0);
        expect(onOpenList).toHaveBeenCalledTimes(control === "list" && release === "inside" ? 1 : 0);
        expect(onPlan).toHaveBeenCalledTimes(control === "plan" && release === "inside" ? 1 : 0);
        expect(card.style.transform).toBe("");
        expect(card.dataset.dragging).toBeUndefined();
        act(() => button.click());
        expect(onOpenVenue).toHaveBeenCalledTimes(control === "answer" ? (release === "inside" ? 2 : 1) : 0);
        expect(onOpenList).toHaveBeenCalledTimes(control === "list" ? (release === "inside" ? 2 : 1) : 0);
        expect(onPlan).toHaveBeenCalledTimes(control === "plan" ? (release === "inside" ? 2 : 1) : 0);
      });
    }
  }
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
