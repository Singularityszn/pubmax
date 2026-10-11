// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";
import type { MapSheetDetent } from "@/lib/mobileShell";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE } from "@/lib/useFocusTrap";

it("keeps the visible map reachable at venue half and isolates it at full", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  function MapWithSheet({ requestedSnap }: { requestedSnap: MapSheetDetent }) {
    const [actualSnap, setActualSnap] = useState<MapSheetDetent>("half");
    return <>
      <main className="mapCanvasWrap">
        <section {...(actualSnap !== "full" ? { [FOCUS_TRAP_EXEMPT_ATTRIBUTE]: "" } : {})}>
          <button id="next-pub">Open another pub</button>
        </section>
        <button id="hidden-control">Hidden map control</button>
      </main>
      <MobileSharedSheet kind="venue" title="Pub detail" requestedSnap={requestedSnap} onSnapChange={setActualSnap} onClose={() => {}}>
        Content
      </MobileSharedSheet>
    </>;
  }
  const render = async (snap: MapSheetDetent) => {
    await act(async () => root.render(<MapWithSheet requestedSnap={snap} />));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  };
  const mapIsInert = () => {
    let node = document.getElementById("next-pub");
    while (node) {
      if (node.inert) return true;
      node = node.parentElement;
    }
    return false;
  };
  try {
    await render("half");
    expect(mapIsInert()).toBe(false);
    expect(document.getElementById("hidden-control")!.inert).toBe(true);
    await render("full");
    expect(mapIsInert()).toBe(true);
    const collapse = document.querySelector<HTMLButtonElement>(".mobileSharedSheetDetent")!;
    collapse.focus();
    await render("half");
    expect(document.querySelector(".mobileSharedSheet")!.classList).toContain("sheet-half");
    expect(mapIsInert()).toBe(false);
    expect(document.activeElement).toBe(collapse);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

// A second pin pick keeps the requested sheet height, including base-pub peek.
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

it("keeps the expanded sheet and typing focus when Android opens and closes the keyboard", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const viewport = Object.assign(new EventTarget(), { height: 844, scale: 1 });
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(
      <MobileSharedSheet kind="planner" title="Plan an outing" onClose={() => {}}>
        <input aria-label="Describe the outing" />
      </MobileSharedSheet>,
    ));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await act(async () => document.querySelector<HTMLButtonElement>(".mobileSharedSheetDetent")!.click());
    const input = document.querySelector<HTMLInputElement>('.mobileSharedSheet input')!;
    input.scrollIntoView = vi.fn();
    await act(async () => input.focus());
    vi.stubGlobal("innerHeight", 544);
    viewport.height = 544;
    await act(async () => {
      viewport.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.activeElement).toBe(input);
    expect(document.querySelector(".mobileSharedSheet")!.classList).toContain("sheet-full");
    vi.stubGlobal("innerHeight", 844);
    viewport.height = 844;
    await act(async () => viewport.dispatchEvent(new Event("resize")));
    expect(document.activeElement).toBe(input);
    expect(document.querySelector(".mobileSharedSheet")!.classList).toContain("sheet-full");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
