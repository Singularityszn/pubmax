// @vitest-environment jsdom

import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";

it.each([320, 390, 430].flatMap((width) =>
  (["planner", "venue"] as const).map((kind) => ({ width, kind })),
))("leaves $width px $kind Escape to the phone sheet", async ({ width, kind }) => {
  const onBack = vi.fn();
  const onHome = vi.fn();
  function MapKeys({ mobileViewport }: { mobileViewport: boolean }) {
    useMapKeyboardShortcuts({
      mobileViewport,
      planningOpen: kind === "planner",
      selectedVenueId: kind === "venue" ? "venue-glw-q7pz7s" : "",
      onBack,
      onInterruptReveal: () => {},
      logIntentFallbackVisible: false,
      dismissLogIntent: () => {},
    });
    return null;
  }
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  try {
    act(() => root.render(<><MapKeys mobileViewport /></>));
    // Open the real sheet after the stable map listener already exists.
    act(() => root.render(<>
      <MapKeys mobileViewport />
      <MobileSharedSheet kind={kind} title="Detail" backLabel="Back to Map controls"
        onBack={onBack} onClose={onHome}>Content</MobileSharedSheet>
    </>));
    act(() => document.querySelector(".mobileSharedSheet")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onHome).not.toHaveBeenCalled();
    // Native Back dispatches directly on window and needs the same ownership.
    act(() => window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ));
    expect(onBack).toHaveBeenCalledTimes(2);
    act(() => root.render(<><MapKeys mobileViewport={false} /></>));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onBack).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

it("handles Escape when an earlier key listener rerenders the map", async () => {
  const onBack = vi.fn();
  function MapKeys({ revision }: { revision: number }) {
    useMapKeyboardShortcuts({
      mobileViewport: false,
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onBack).toHaveBeenCalledExactlyOnceWith(1);
  } finally {
    window.removeEventListener("keydown", earlierListener);
    act(() => root.unmount());
    host.remove();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
