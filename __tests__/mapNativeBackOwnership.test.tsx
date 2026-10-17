// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { dispatchDismissKey, performBackAction } from "@/lib/nativeBackGesture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Surface = "venue" | "planner" | "drop" | "none";
const surfaceBack = vi.fn();
const dismissDrop = vi.fn();
const interruptReveal = vi.fn();
const minimize = vi.fn();

function MapKeys({ surface }: { surface: Surface }) {
  useMapKeyboardShortcuts({
    mobileViewport: false,
    planningOpen: surface === "planner",
    selectedVenueId: surface === "venue" || surface === "drop" ? "selected-pub" : "",
    onBack: surfaceBack,
    onInterruptReveal: interruptReveal,
    logIntentFallbackVisible: surface === "drop",
    dismissLogIntent: dismissDrop,
  });
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  surfaceBack.mockClear();
  dismissDrop.mockClear();
  interruptReveal.mockClear();
  minimize.mockClear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function nativeBack(canGoBack: boolean) {
  let action: ReturnType<typeof performBackAction> | undefined;
  act(() => {
    action = performBackAction(canGoBack, {
      dismiss: () => dispatchDismissKey(),
      // PubMap's keyboard Back and the native history fallback both enter
      // this same authority. An unclaimed Escape would call it twice.
      goBack: surfaceBack,
      exit: minimize,
    });
  });
  return action;
}

describe("native Back spends a map-owned Escape once", () => {
  it.each((["venue", "planner", "drop"] as const).flatMap((surface) =>
    [true, false].map((canGoBack) => ({ surface, canGoBack })),
  ))("closes $surface once with native history=$canGoBack", ({ surface, canGoBack }) => {
    act(() => root.render(<MapKeys surface={surface} />));
    const action = nativeBack(canGoBack);
    if (surface === "drop") {
      expect(dismissDrop).toHaveBeenCalledTimes(1);
      expect(surfaceBack).not.toHaveBeenCalled();
      expect(interruptReveal).not.toHaveBeenCalled();
    } else {
      expect(surfaceBack).toHaveBeenCalledTimes(1);
      expect(interruptReveal).toHaveBeenCalledTimes(1);
      expect(dismissDrop).not.toHaveBeenCalled();
    }
    expect(minimize).not.toHaveBeenCalled();
    expect(action).toEqual({ kind: "dismissed", reason: "panel" });
  });

  it.each([true, false])("leaves the native fallback available on an empty map with history=%s", (canGoBack) => {
    act(() => root.render(<MapKeys surface="none" />));
    expect(nativeBack(canGoBack)).toEqual(canGoBack ? { kind: "history" } : { kind: "exit" });
    expect(surfaceBack).toHaveBeenCalledTimes(canGoBack ? 1 : 0);
    expect(minimize).toHaveBeenCalledTimes(canGoBack ? 0 : 1);
    expect(dismissDrop).not.toHaveBeenCalled();
    expect(interruptReveal).not.toHaveBeenCalled();
  });
});
