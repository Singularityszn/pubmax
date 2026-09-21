// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchDismissKey, performBackAction } from "@/lib/nativeBackGesture";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("native Back reaches the active surface once", () => {
  it("lets a document-bound picker claim Back before history", () => {
    const close = vi.fn((event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    });
    const history = vi.fn();
    document.addEventListener("keydown", close);
    try {
      performBackAction(true, { dismiss: () => dispatchDismissKey(), goBack: history, exit: vi.fn() });
      expect(close).toHaveBeenCalledTimes(1);
      expect(history).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", close);
    }
  });

  it.each(["planner", "venue", "log-picker"])("spends one Back on %s", (surface) => {
    const history = vi.fn();
    const dismissLogIntent = vi.fn();
    function MapKeys() {
      useMapKeyboardShortcuts({
        planningOpen: surface === "planner",
        selectedVenueId: surface === "venue" ? "venue-a" : "",
        logIntentFallbackVisible: surface === "log-picker",
        onBack: history,
        onInterruptReveal: vi.fn(),
        dismissLogIntent,
      });
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => { root?.render(<MapKeys />); });
    act(() => { performBackAction(true, { dismiss: () => dispatchDismissKey(), goBack: history, exit: vi.fn() }); });
    expect(history).toHaveBeenCalledTimes(surface === "log-picker" ? 0 : 1);
    expect(dismissLogIntent).toHaveBeenCalledTimes(surface === "log-picker" ? 1 : 0);
  });
});
