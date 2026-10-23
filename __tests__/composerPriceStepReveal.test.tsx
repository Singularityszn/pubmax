// @vitest-environment jsdom

// The log intent's reveal waits for the composer's price step, and the step
// answers as it mounts. This mounts the real step and watches the scroll land.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerPriceStep } from "@/components/map/composer/ComposerPriceStep";
import { DEFAULT_DRINK_MEASURE } from "@/lib/drinkMeasure";
import { cancelLogIntentReveal, requestLogIntentReveal } from "@/lib/logIntentReveal";

let host: HTMLDivElement;
let root: Root | null;
let scrolled: Array<{ element: Element; options: unknown }>;

function mountStep(): HTMLElement {
  act(() => {
    root = createRoot(host);
    root.render(
      createElement(ComposerPriceStep, {
        dropForm: {
          price: "",
          drink: "",
          measure: DEFAULT_DRINK_MEASURE,
          measureLabel: "",
          note: "",
          era: "",
          withWho: "",
        },
        setDropForm: () => {},
        priceQuickAdds: [5, 6],
        lastKnownPrice: null,
      }),
    );
  });
  const step = host.querySelector<HTMLElement>('[data-testid="spill-price-step"]');
  if (!step) throw new Error("the price step did not mount");
  return step;
}

function unmountStep(): void {
  act(() => root?.unmount());
  root = null;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element, options?: unknown) {
    scrolled.push({ element: this, options });
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = null;
});

afterEach(() => {
  unmountStep();
  host.remove();
  cancelLogIntentReveal();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("the price step takes the waiting reveal as it mounts", () => {
  it("scrolls itself into view once when a log intent asked before it existed", () => {
    requestLogIntentReveal(document, false, () => {});
    const step = mountStep();
    expect(scrolled).toEqual([{ element: step, options: { behavior: "smooth", block: "start" } }]);
  });

  it("jumps rather than glides when the reader asked for less motion", () => {
    requestLogIntentReveal(document, true, () => {});
    const step = mountStep();
    expect(scrolled).toEqual([{ element: step, options: { behavior: "auto", block: "start" } }]);
  });

  it("does not scroll a step that mounts with no log intent waiting", () => {
    mountStep();
    expect(scrolled).toEqual([]);
  });

  it("spends the request, so a composer opened again later does not scroll", () => {
    requestLogIntentReveal(document, false, () => {});
    mountStep();
    unmountStep();
    mountStep();
    expect(scrolled).toHaveLength(1);
  });

  it("does not scroll when the sheet closed before the step mounted", () => {
    requestLogIntentReveal(document, false, () => {});
    cancelLogIntentReveal();
    mountStep();
    expect(scrolled).toEqual([]);
  });
});
