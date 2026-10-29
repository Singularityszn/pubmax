// @vitest-environment jsdom

import { act, useState } from "react";
import Link from "next/link";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AuthContext, useAuth } from "@/components/auth/authContext";
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
        <input aria-label="Where, how many, what budget" />
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

it.each(["drink", "venue", "planner"] as const)(
  "keeps the full %s sheet and Close available as portal clearance grows and recovers",
  async (kind) => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 568);
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const styles = document.head.appendChild(document.createElement("style"));
    styles.textContent = ".mobileSheetPortal { bottom: 64px; }";
    const observers = new Set<PortalResizeObserver>();
    class PortalResizeObserver implements ResizeObserver {
      readonly targets = new Set<Element>();
      constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
      observe(target: Element) { this.targets.add(target); }
      unobserve(target: Element) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); observers.delete(this); }
    }
    vi.stubGlobal("ResizeObserver", PortalResizeObserver);
    const notifyResize = (target: Element, height: number) => {
      for (const observer of observers) {
        if (!observer.targets.has(target)) continue;
        observer.callback([{
          target,
          contentRect: new DOMRect(0, 0, 390, height),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        }], observer);
      }
    };
    const close = vi.fn();
    try {
      await act(async () => root.render(
        <MobileSharedSheet kind={kind} title="Drink" initialSnap="full" onClose={close}>
          <div style={{ height: 1200 }}>Drink choices and Spoons legend</div>
        </MobileSharedSheet>,
      ));
      const portal = document.querySelector<HTMLElement>(".mobileSheetPortal")!;
      const sheet = portal.querySelector<HTMLElement>(".mobileSharedSheet")!;
      const closeButton = portal.querySelector<HTMLButtonElement>('[aria-label^="Close"]')!;
      const header = sheet.querySelector<HTMLElement>(".mobileSharedSheetHeader")!;
      const footer = sheet.querySelector<HTMLElement>(".mobileSharedSheetFooter")!;
      Object.defineProperty(header, "offsetHeight", { value: 64 });
      Object.defineProperty(footer, "offsetHeight", { value: 0 });
      await act(async () => notifyResize(header, 64));
      expect(Number.parseFloat(sheet.style.maxHeight)).toBeCloseTo(458.56);
      for (const { bottom, availableHeight, expectedCap } of [
        { bottom: 192, availableHeight: 376, expectedCap: 330.56 },
        { bottom: 64, availableHeight: 504, expectedCap: 458.56 },
        { bottom: 192, availableHeight: 376, expectedCap: 330.56 },
      ]) {
        await act(async () => {
          portal.style.bottom = `${bottom}px`;
          notifyResize(portal, availableHeight);
        });
        expect(document.querySelector(".mobileSharedSheet")).toBe(sheet);
        expect(sheet.classList).toContain("sheet-full");
        expect(Number.parseFloat(sheet.style.maxHeight)).toBeCloseTo(expectedCap);
        expect(Number.parseFloat(sheet.style.maxHeight)).toBeLessThanOrEqual(availableHeight);
        expect(portal.querySelector('[aria-label^="Close"]')).toBe(closeButton);
        expect(closeButton.disabled).toBe(false);
        await act(async () => closeButton.focus());
        expect(document.activeElement).toBe(closeButton);
      }
      expect(close).not.toHaveBeenCalled();
      await act(async () => closeButton.click());
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      styles.remove();
      host.remove();
      vi.unstubAllGlobals();
      environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  },
);


it("releases logical Close and background focus before the exit spring rests", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const inertDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  // jsdom has no layout. Supply only the measured sheet height used by the real spring.
  const rectangle = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, 390, this.classList.contains("mobileSharedSheet") ? 400 : 44);
  });
  const close = vi.fn();
  function Surface() {
    const [open, setOpen] = useState(false);
    return <>
      <main><button onClick={() => setOpen(true)}>Open prices</button><Link href="/">Home</Link></main>
      <MobileSharedSheet kind={open ? "filters" : null} title="Prices and places" onClose={() => {
        close();
        setOpen(false);
      }}>Filter choices</MobileSharedSheet>
    </>;
  }
  try {
    await act(async () => root.render(<Surface />));
    const opener = host.querySelector<HTMLButtonElement>("button")!;
    opener.focus();
    await act(async () => opener.click());
    expect(opener.closest("[inert]")).not.toBeNull();
    const closeButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("aria-label") === "Close Prices and places")!;
    expect(closeButton).toBeDefined();
    await act(async () => closeButton.click());
    // No animation frame ran after Close. The live page must already own input.
    expect(close).toHaveBeenCalledTimes(1);
    expect(opener.closest("[inert]")).toBeNull();
    const home = host.querySelector<HTMLAnchorElement>('a[href="/"]')!;
    await act(async () => home.focus());
    expect(document.activeElement).toBe(home);
    const exiting = document.querySelector<HTMLElement>(".mobileSheetPortal");
    expect(exiting).not.toBeNull();
    expect(exiting!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(exiting!.closest("[inert]")).not.toBeNull();
    for (const timestamp of [0, 5_000, 10_000, 15_000]) {
      await act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(timestamp);
      });
    }
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(home);
    expect(document.querySelector(".mobileSheetPortal")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    rectangle.mockRestore();
    host.remove();
    vi.unstubAllGlobals();
    if (inertDescriptor) Object.defineProperty(HTMLElement.prototype, "inert", inertDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "inert");
    environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});


it.each(["reopen", "new-kind", "owner-change", "unmount", "reduced-motion", "swipe-close"] as const)(
  "keeps explicit Close isolated from later lifecycle work: %s",
  async (mode) => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("matchMedia", () => ({ matches: mode === "reduced-motion", addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const rectangle = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, 390, this.classList.contains("mobileSharedSheet") ? 400 : 44);
    });
    const close = vi.fn();
    function Surface() {
      const [kind, setKind] = useState<"filters" | "planner" | null>("filters");
      const [revision, setRevision] = useState(0);
      const auth = useAuth();
      return <>
        <button onClick={() => mode === "owner-change" ? setRevision(1) : setKind(mode === "new-kind" ? "planner" : "filters")}>Open next surface</button>
        <AuthContext.Provider value={{ ...auth, accountRevision: revision }}><MobileSharedSheet kind={kind} title={kind === "planner" ? "Plan an outing" : "Prices and places"}
          onClose={() => { close(); setKind(null); }}>Current content</MobileSharedSheet></AuthContext.Provider>
      </>;
    }
    let unmounted = false;
    try {
      await act(async () => root.render(<Surface />));
      const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="Close Prices and places"]')!;
      if (mode === "swipe-close") {
        const header = document.querySelector<HTMLElement>(".mobileSharedSheetHeader")!;
        header.setPointerCapture = () => {};
        header.hasPointerCapture = () => true;
        header.releasePointerCapture = () => {};
        const pointer = (type: string, clientY: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            pointerId: { value: 1 }, pointerType: { value: "touch" },
            isPrimary: { value: true }, button: { value: 0 },
            clientX: { value: 100 }, clientY: { value: clientY },
          });
          return event;
        };
        await act(async () => header.dispatchEvent(pointer("pointerdown", 100)));
        await act(async () => header.dispatchEvent(pointer("pointermove", 480)));
        await act(async () => header.dispatchEvent(pointer("pointerup", 480)));
        expect(close).not.toHaveBeenCalled();
      }
      await act(async () => closeButton.click());
      expect(close).toHaveBeenCalledTimes(1);
      if (mode === "reduced-motion") {
        expect(document.querySelector(".mobileSheetPortal")).toBeNull();
      } else {
        expect(document.querySelector('.mobileSheetPortal[aria-hidden="true"][inert]')).not.toBeNull();
      }
      if (mode === "swipe-close") {
        // Let the superseded gesture's former rest deadline pass before a new surface.
        for (const timestamp of [0, 5_000, 10_000, 15_000]) {
          await act(async () => {
            const pending = [...frames.values()];
            frames.clear();
            for (const callback of pending) callback(timestamp);
          });
        }
        expect(close).toHaveBeenCalledTimes(1);
      }
      if (mode === "unmount") {
        await act(async () => root.unmount());
        unmounted = true;
        expect(document.querySelector(".mobileSheetPortal")).toBeNull();
        expect(frames.size).toBe(0);
      } else if (mode !== "reduced-motion") {
        await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
        expect(document.querySelector('.mobileSheetPortal[aria-hidden="true"]')).toBeNull();
        if (mode === "owner-change") expect(document.querySelector(".mobileSheetPortal")).toBeNull();
        else expect(document.querySelector(".mobileSharedSheet h2")!.textContent)
          .toBe(mode === "new-kind" ? "Plan an outing" : "Prices and places");
      }
      for (const timestamp of [0, 5_000, 10_000, 15_000]) {
        await act(async () => {
          const pending = [...frames.values()];
          frames.clear();
          for (const callback of pending) callback(timestamp);
        });
      }
      expect(close).toHaveBeenCalledTimes(1);
      if (mode === "reopen" || mode === "new-kind" || mode === "swipe-close") {
        expect(document.querySelector(".mobileSharedSheet h2")!.textContent)
          .toBe(mode === "new-kind" ? "Plan an outing" : "Prices and places");
      }
    } finally {
      if (!unmounted) await act(async () => root.unmount());
      rectangle.mockRestore();
      host.remove();
      vi.unstubAllGlobals();
      environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  },
);
