// @vitest-environment jsdom

// The map takes back a log intent's waiting reveal when that wait can no longer
// end in the composer the intent opened: when the sheet closes, when that
// composer closes, and when the map unmounts.
// This mounts the real hook beside the real price step and watches whether a
// later composer still scrolls.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerPriceStep } from "@/components/map/composer/ComposerPriceStep";
import { useLogIntentRevealScope } from "@/components/map/pubmap/useLogIntentRevealScope";
import { DEFAULT_DRINK_MEASURE } from "@/lib/drinkMeasure";
import { cancelLogIntentReveal, requestLogIntentReveal } from "@/lib/logIntentReveal";

let host: HTMLDivElement;
let root: Root | null;
let scrolls: number;

// The map, standing in: the hook at a fixed place in the tree, and the
// composer's price step beside it once the sheet has loaded it.
function MapStandIn({
  detailOpen,
  composerOpen = detailOpen,
  composer,
}: {
  detailOpen: boolean;
  composerOpen?: boolean;
  composer: boolean;
}) {
  useLogIntentRevealScope(detailOpen, composerOpen);
  return composer ? priceStep() : null;
}

function render(node: ReturnType<typeof createElement> | null): void {
  act(() => {
    root ??= createRoot(host);
    root.render(node);
  });
}

function priceStep() {
  return createElement(ComposerPriceStep, {
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
  });
}

function unmount(): void {
  act(() => root?.unmount());
  root = null;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  scrolls = 0;
  Element.prototype.scrollIntoView = vi.fn(() => {
    scrolls += 1;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = null;
});

afterEach(() => {
  unmount();
  host.remove();
  cancelLogIntentReveal();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("the map scopes a waiting reveal to itself", () => {
  it("leaves the request for the composer while the sheet stays open", () => {
    render(createElement(MapStandIn, { detailOpen: true, composer: false }));
    requestLogIntentReveal(document, false, () => {});
    render(createElement(MapStandIn, { detailOpen: true, composer: true }));
    expect(scrolls).toBe(1);
  });

  it("drops the request when the sheet closes before the composer mounts", () => {
    render(createElement(MapStandIn, { detailOpen: true, composer: false }));
    requestLogIntentReveal(document, false, () => {});
    render(createElement(MapStandIn, { detailOpen: false, composer: false }));
    render(createElement(MapStandIn, { detailOpen: true, composer: true }));
    expect(scrolls).toBe(0);
  });

  it("drops the request when another pub closes the composer before its step mounts", () => {
    render(createElement(MapStandIn, { detailOpen: true, composer: false }));
    requestLogIntentReveal(document, false, () => {});
    render(createElement(MapStandIn, { detailOpen: true, composerOpen: false, composer: false }));
    render(createElement(MapStandIn, { detailOpen: true, composer: true }));
    expect(scrolls).toBe(0);
  });

  it("drops the request when the map unmounts with the sheet still open", () => {
    render(createElement(MapStandIn, { detailOpen: true, composer: false }));
    requestLogIntentReveal(document, false, () => {});
    unmount();
    render(createElement(MapStandIn, { detailOpen: true, composer: true }));
    expect(scrolls).toBe(0);
  });
});
