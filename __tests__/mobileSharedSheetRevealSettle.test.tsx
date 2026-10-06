// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";
import type { MapSheetDetent } from "@/lib/mobileShell";

// A second pin pick bumps the reveal-settle sequence. The sheet must settle
// where the host asked: a base pub asks for peek so the map behind it stays
// live, and half inerts that map, so the next pin cannot be reached.
it.each([
  { requestedSnap: "peek" as const, expected: "sheet-peek" },
  { requestedSnap: "half" as const, expected: "sheet-half" },
])("settles a second pick to the requested $requestedSnap", ({ requestedSnap, expected }) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const render = (snap: MapSheetDetent, sequence: number) =>
    act(() => root.render(
      <MobileSharedSheet
        kind="venue"
        title="Pub detail"
        requestedSnap={snap}
        venueRevealSettleSequence={sequence}
        onClose={() => {}}
      >
        Content
      </MobileSharedSheet>,
    ));
  try {
    render(requestedSnap, 0);
    expect(document.querySelector(".mobileSharedSheet")!.classList).toContain(expected);
    // Pub B replaces pub A at the same requested detent.
    render(requestedSnap, 1);
    expect(document.querySelector(".mobileSharedSheet")!.classList).toContain(expected);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
