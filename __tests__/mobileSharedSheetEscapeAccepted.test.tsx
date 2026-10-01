// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";

it("leaves a consumed nested Escape with the popover inside the real phone sheet", () => {
  const onBack = vi.fn();
  const onHome = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  try {
    act(() => root.render(
      <MobileSharedSheet kind="venue" title="Pub" onBack={onBack} onClose={onHome}>
        <button onKeyDown={(event) => {
          if (event.key === "Escape") event.preventDefault();
        }}>Nested options</button>
      </MobileSharedSheet>,
    ));
    const control = Array.from(document.querySelectorAll<HTMLButtonElement>(".mobileSharedSheet button"))
      .find((button) => button.textContent === "Nested options");
    expect(control).toBeDefined();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => control!.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(onBack).not.toHaveBeenCalled();
    expect(onHome).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

it.each([
  { requestedSnap: "full" as const, expectedHeight: 776.48 },
  { requestedSnap: undefined, expectedHeight: 464.2 },
])("opens at its requested detent before any height spring frame ($requestedSnap)", ({
  requestedSnap,
  expectedHeight,
}) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  // Hold the next presentation frame: opening must lay out its resting height
  // immediately. Only the entrance transform animates after this commit.
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  try {
    act(() => root.render(
      <MobileSharedSheet
        kind="venue"
        title="Pub"
        initialSnap="half"
        requestedSnap={requestedSnap}
        onClose={() => {}}
      >
        <p>Pub details</p>
      </MobileSharedSheet>,
    ));
    const sheet = document.querySelector<HTMLElement>(".mobileSharedSheet");
    expect(sheet).not.toBeNull();
    expect(Number.parseFloat(sheet!.style.maxHeight)).toBeCloseTo(expectedHeight, 2);
    expect(sheet!.classList.contains(`sheet-${requestedSnap ?? "half"}`)).toBe(true);
    expect(sheet!.dataset.sheetMotion).toBe("entering");
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
