// @vitest-environment jsdom

import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";

it("handles Escape when an earlier key listener rerenders the map", () => {
  const onBack = vi.fn();
  function MapKeys({ revision }: { revision: number }) {
    useMapKeyboardShortcuts({
      planningOpen: false,
      selectedVenueId: "venue-glw-q7pz7s",
      onBack: () => onBack(revision),
      onInterruptReveal: () => {},
      logIntentFallbackVisible: false,
      dismissLogIntent: () => {},
    });
    return null;
  }

  let rerenderMap = () => {};
  const earlierListener = () => flushSync(rerenderMap);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  window.addEventListener("keydown", earlierListener);
  try {
    act(() => root.render(createElement(MapKeys, { revision: 0 })));
    rerenderMap = () => root.render(createElement(MapKeys, { revision: 1 }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onBack).toHaveBeenCalledExactlyOnceWith(1);
  } finally {
    window.removeEventListener("keydown", earlierListener);
    act(() => root.unmount());
    host.remove();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
