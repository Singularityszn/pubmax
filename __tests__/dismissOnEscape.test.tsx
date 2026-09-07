// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import MapLayersControl from "@/components/map/MapLayersControl";
import { POI_CATEGORIES, type PoiCategory } from "@/lib/pois";

let host: HTMLDivElement;
let root: Root;

function Panel({ open = true, dismiss }: { open?: boolean; dismiss: () => void }) {
  useDismissOnEscape(open, dismiss);
  return null;
}

function MapFallback({ back, drop = false, dismissDrop = () => {} }: {
  back: () => void;
  drop?: boolean;
  dismissDrop?: () => void;
}) {
  useMapKeyboardShortcuts({
    planningOpen: false,
    selectedVenueId: "venue-selected",
    onBack: back,
    onInterruptReveal: () => {},
    logIntentFallbackVisible: drop,
    dismissLogIntent: dismissDrop,
  });
  return null;
}

function render(children: React.ReactNode) {
  act(() => root.render(children));
}

function escape(target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("one Escape dismisses one active panel", () => {
  it("closes a later popover, then the underlying list on the next press", () => {
    const list = vi.fn();
    const layers = vi.fn();
    const panels = (open: boolean) => [
      createElement(Panel, { key: "list", dismiss: list }),
      createElement(Panel, { key: "layers", open, dismiss: layers }),
    ];
    render(panels(false));
    render(panels(true));
    expect(escape().defaultPrevented).toBe(true);
    expect(layers).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    render(panels(false));
    escape();
    expect(list).toHaveBeenCalledTimes(1);
    expect(layers).toHaveBeenCalledTimes(1);
  });

  it("updates a callback without moving its panel above a newer modal", () => {
    const original = vi.fn();
    const updated = vi.fn();
    const modal = vi.fn();
    const panels = (dismiss: () => void, open: boolean) => [
      createElement(Panel, { key: "lower", dismiss }),
      createElement(Panel, { key: "modal", open, dismiss: modal }),
    ];
    render(panels(original, false));
    render(panels(original, true));
    render(panels(updated, true));
    escape();
    expect(modal).toHaveBeenCalledTimes(1);
    expect(updated).not.toHaveBeenCalled();
    expect(original).not.toHaveBeenCalled();
    render(panels(updated, false));
    escape();
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it("keeps the upper panel when a lower panel unmounts", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const upperPanel = createElement(Panel, { key: "upper", dismiss: upper });
    render([createElement(Panel, { key: "lower", dismiss: lower }), upperPanel]);
    render([upperPanel]);
    escape();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("leaves embedded Layers dismissal to its containing sheet", () => {
    const dismissSheet = vi.fn();
    render([
      createElement(Panel, { key: "sheet", dismiss: dismissSheet }),
      createElement(MapLayersControl, {
        key: "layers",
        embedded: true,
        poiHidden: Object.fromEntries(
          POI_CATEGORIES.map((category) => [category, true]),
        ) as Record<PoiCategory, boolean>,
        onPoiHiddenChange: () => {},
      }),
    ]);
    expect(escape().defaultPrevented).toBe(true);
    expect(dismissSheet).toHaveBeenCalledTimes(1);
  });

  it.each(["before", "after"] as const)("yields the map fallback registered %s the panel", (position) => {
    const back = vi.fn();
    const dismiss = vi.fn();
    const fallback = createElement(MapFallback, { key: "map", back });
    const panel = createElement(Panel, { key: "panel", dismiss });
    render(position === "before" ? [fallback, panel] : [panel, fallback]);
    escape();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    render([fallback]);
    escape();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("dismisses the Drop pub picker before an underlying popover", () => {
    const popover = vi.fn();
    const dismissDrop = vi.fn();
    const back = vi.fn();
    const panels = (drop: boolean) => [
      createElement(Panel, { key: "popover", dismiss: popover }),
      createElement(MapFallback, { key: "map", back, drop, dismissDrop }),
    ];
    render(panels(false));
    render(panels(true));
    escape();
    expect(dismissDrop).toHaveBeenCalledTimes(1);
    expect(popover).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it("lets a focused control consume Escape before a panel", () => {
    const dismiss = vi.fn();
    render([
      createElement(Panel, { key: "panel", dismiss }),
      createElement("input", { key: "input", onKeyDown: (event) => event.preventDefault() }),
    ]);
    escape(host.querySelector("input")!);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("cancels native Back synchronously and removes unmounted owners", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    render([
      createElement(Panel, { key: "lower", dismiss: lower }),
      createElement(Panel, { key: "upper", dismiss: upper }),
    ]);
    expect(dispatchDismissKey()).toBe(true);
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    render(null);
    expect(dispatchDismissKey()).toBe(false);
  });

  it("keeps one owner after Strict Mode replays effects", () => {
    const dismiss = vi.fn();
    render(createElement(StrictMode, null, createElement(Panel, { dismiss })));
    escape();
    expect(dismiss).toHaveBeenCalledTimes(1);
    render(null);
    expect(escape().defaultPrevented).toBe(false);
  });
});
