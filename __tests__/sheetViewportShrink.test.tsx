// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSheetHeightDrag } from "@/components/mobile/useSheetHeightDrag";
import { sheetSnapCaps } from "@/lib/sheetSnap";

// THE SHEET FOLLOWS A VIEWPORT THAT SHRINKS UNDER IT.
//
// The resting height is a px value applied inline, so it outranks the `dvh`
// caps in the stylesheet. The Android WebView inside the Capacitor shell
// shrinks the layout viewport by the keyboard (a Pixel 7 lost 235px), and a
// full sheet still 711px tall was pushed 237px above the top edge with the
// field being typed into. Measured through the WebView's own DevTools:
// docs/proof/mobile-app-design/android-emu-pixel7/composer/.

type Probe = { snapshot: ReturnType<typeof useSheetHeightDrag> | null };

function Harness({
  onRender,
  onDismiss = () => {},
}: {
  onRender: (drag: ReturnType<typeof useSheetHeightDrag>) => void;
  onDismiss?: () => void;
}) {
  const drag = useSheetHeightDrag(onDismiss);
  onRender(drag);
  return createElement("section", { className: "mapDrawer", style: { height: drag.sheetHeight } },
    createElement("header", {
      onPointerDown: drag.onSheetDragStart,
      onPointerMove: drag.onSheetDragMove,
      onPointerUp: drag.onSheetDragEnd,
      onPointerCancel: drag.onSheetDragEnd,
    }, "Drag"));
}

let root: Root | null = null;

// The spring reads prefers-reduced-motion; jsdom has no matchMedia.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
});

function setViewport(height: number, width = 390) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(onDismiss?: () => void): Promise<Probe> {
  const probe: Probe = { snapshot: null };
  const onRender = (drag: ReturnType<typeof useSheetHeightDrag>) => {
    probe.snapshot = drag;
  };
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(createElement(Harness, { onRender, onDismiss })));
  return probe;
}

describe("useSheetHeightDrag under a shrinking layout viewport", () => {
  it("keeps a full sheet below the top edge while reserving the primary dock", async () => {
    setViewport(568);
    const portal = document.body.appendChild(document.createElement("div"));
    portal.className = "mobileSheetPortal";
    portal.style.bottom = "64px";
    const probe = await mount();
    await act(async () => probe.snapshot!.openAtSnap("full"));
    expect(probe.snapshot!.sheetHeight).toBe(sheetSnapCaps(568, 64).full);
    expect(probe.snapshot!.sheetHeight! + 64).toBeLessThan(568);
  });

  it("peeks at exactly the header and command bar once the footer holds one", async () => {
    setViewport(568, 320);
    const portal = document.body.appendChild(document.createElement("div"));
    portal.className = "mobileSheetPortal";
    portal.style.bottom = "64px";
    const sheet = portal.appendChild(document.createElement("section"));
    sheet.className = "mobileSharedSheet";
    const height = (element: HTMLElement, px: number) =>
      Object.defineProperty(element, "offsetHeight", { configurable: true, value: px });
    height(sheet.appendChild(document.createElement("header")), 64);
    const body = sheet.appendChild(document.createElement("div"));
    body.className = "mobileSharedSheetBody";
    body.style.padding = "8px 16px";
    const footer = sheet.appendChild(document.createElement("div"));
    footer.className = "mobileSharedSheetFooter";
    height(footer, 0);
    const probe = await mount();

    await act(async () => probe.snapshot!.openAtSnap("peek"));
    expect(probe.snapshot!.sheetHeight).toBe(sheetSnapCaps(568, 64).peek);

    height(footer, 121);
    await act(async () => probe.snapshot!.recapToViewport());
    expect(probe.snapshot!.sheetHeight).toBe(64 + 121);
    expect(probe.snapshot!.settling).toBe(false);
  });

  it.each(["peek", "half", "full"] as const)("re-caps %s and its command bar when the voice band grows", async (snap) => {
    setViewport(320, 568);
    const portal = document.body.appendChild(document.createElement("div"));
    portal.className = "mobileSheetPortal";
    portal.style.bottom = "64px";
    const sheet = portal.appendChild(document.createElement("section"));
    sheet.className = "mobileSharedSheet";
    const header = sheet.appendChild(document.createElement("header"));
    Object.defineProperty(header, "offsetHeight", { value: 64 });
    const body = sheet.appendChild(document.createElement("div"));
    body.className = "mobileSharedSheetBody";
    body.style.padding = "8px 16px";
    const footer = sheet.appendChild(document.createElement("div"));
    footer.className = "mobileSharedSheetFooter";
    Object.defineProperty(footer, "offsetHeight", { value: 121 });
    const probe = await mount();

    await act(async () => probe.snapshot!.openAtSnap(snap));
    const initialHeight = probe.snapshot!.sheetHeight;
    expect(initialHeight).toBeGreaterThan(124);

    portal.style.paddingTop = "132px";
    await act(async () => probe.snapshot!.recapToViewport());
    expect(probe.snapshot!.sheetHeight).toBe(124);
    expect(probe.snapshot!.sheetSnap).toBe(snap);
    expect(probe.snapshot!.settling).toBe(false);

    portal.style.paddingTop = "0px";
    await act(async () => probe.snapshot!.recapToViewport());
    expect(probe.snapshot!.sheetHeight).toBe(initialHeight);
  });

  it("restores an open sheet after the voice band temporarily consumes its space", async () => {
    setViewport(320, 568);
    const portal = document.body.appendChild(document.createElement("div"));
    portal.className = "mobileSheetPortal";
    portal.style.bottom = "64px";
    portal.style.paddingTop = "280px";
    const probe = await mount();
    await act(async () => probe.snapshot!.openAtSnap("full"));
    expect(probe.snapshot!.sheetHeight).toBe(0);

    portal.style.paddingTop = "132px";
    await act(async () => probe.snapshot!.recapToViewport());
    expect(probe.snapshot!.sheetHeight).toBe(124);
    expect(probe.snapshot!.sheetSnap).toBe("full");
  });

  it("re-caps an open sheet to the new viewport, jumping rather than springing", async () => {
    setViewport(773);
    const probe = await mount();
    await act(async () => probe.snapshot!.openAtSnap("full"));
    expect(probe.snapshot!.sheetHeight).toBe(sheetSnapCaps(773, 0).full);

    setViewport(538);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(probe.snapshot!.sheetHeight).toBe(sheetSnapCaps(538, 0).full);
    // A jump, not a spring: the height is already at rest.
    expect(probe.snapshot!.settling).toBe(false);
  });

  it.each([
    { initialReserve: 84, reserve: 132, full: 648 },
    { initialReserve: 132, reserve: 84, full: 696 },
  ])("uses a changed voice band from $initialReserve to $reserve during a drag", async ({ initialReserve, reserve, full }) => {
    setViewport(844);
    const portal = document.body.appendChild(document.createElement("div"));
    portal.className = "mobileSheetPortal";
    portal.style.bottom = "64px";
    portal.style.paddingTop = `${initialReserve}px`;
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true, addEventListener() {}, removeEventListener() {},
    } as unknown as MediaQueryList);
    try {
      const probe = await mount();
      await act(async () => probe.snapshot!.openAtSnap("full"));
      const initialHeight = probe.snapshot!.sheetHeight;
      const drawer = document.querySelector<HTMLElement>(".mapDrawer")!;
      const header = drawer.querySelector("header")!;
      vi.spyOn(drawer, "getBoundingClientRect").mockImplementation(() => ({ height: probe.snapshot!.sheetHeight } as DOMRect));
      header.setPointerCapture = vi.fn();
      header.hasPointerCapture = () => true;
      header.releasePointerCapture = vi.fn();
      const pointer = async (type: string, clientY: number) => {
        await act(async () => header.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY })));
      };

      await pointer("pointerdown", 200);
      portal.style.paddingTop = `${reserve}px`;
      await act(async () => probe.snapshot!.recapToViewport());
      expect(probe.snapshot!.dragging).toBe(true);
      expect(probe.snapshot!.sheetHeight).toBe(initialHeight);

      await pointer("pointerup", 200);
      expect(probe.snapshot!.sheetSnap).toBe("full");
      expect(probe.snapshot!.sheetHeight).toBe(full);
      expect(844 - 64 - probe.snapshot!.sheetHeight).toBe(reserve);

      await pointer("pointerdown", 200);
      portal.style.paddingTop = `${initialReserve}px`;
      await act(async () => probe.snapshot!.recapToViewport());
      await pointer("pointermove", 180);
      if (initialReserve > reserve) {
        expect(probe.snapshot!.sheetHeight).toBeLessThan(full);
        expect(probe.snapshot!.sheetHeight).toBeGreaterThan(initialHeight);
      } else {
        expect(probe.snapshot!.sheetHeight).toBe(full + 20);
      }
      await pointer("pointercancel", 180);
      expect(probe.snapshot!.sheetHeight).toBe(initialHeight);
      expect(probe.snapshot!.dragging).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("brings the field that holds focus back into its scroller", async () => {
    setViewport(773);
    const probe = await mount();
    await act(async () => probe.snapshot!.openAtSnap("full"));
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    const reveal = vi.fn();
    input.scrollIntoView = reveal;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    setViewport(538);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(reveal).toHaveBeenCalledWith({ block: "nearest" });
    raf.mockRestore();
  });

  it("lets a dismiss in flight finish through viewport and header or footer re-caps", async () => {
    setViewport(844);
    const onDismiss = vi.fn();
    const probe = await mount(onDismiss);
    await act(async () => probe.snapshot!.openAtSnap("full"));
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    let now = 0;
    const runFrame = async () => {
      const next = frames.shift();
      if (!next) return;
      now += 16;
      await act(async () => next(now));
    };
    try {
      await act(async () => probe.snapshot!.requestDismiss());
      await runFrame();
      await runFrame();
      const midDismiss = probe.snapshot!.sheetHeight;
      expect(midDismiss).toBeLessThan(sheetSnapCaps(844, 0).full);

      setViewport(544);
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        probe.snapshot!.recapToViewport();
      });
      expect(probe.snapshot!.settling).toBe(true);
      expect(probe.snapshot!.sheetHeight).toBe(midDismiss);

      for (let frame = 0; frame < 500 && frames.length; frame += 1) await runFrame();
      expect(probe.snapshot!.sheetHeight).toBe(0);
      expect(onDismiss).toHaveBeenCalledTimes(1);

      setViewport(844);
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(probe.snapshot!.sheetHeight).toBe(0);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      raf.mockRestore();
    }
  });

  it("leaves a closed sheet and a live drag alone", async () => {
    setViewport(773);
    const probe = await mount();
    expect(probe.snapshot!.sheetHeight).toBe(0);
    setViewport(538);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(probe.snapshot!.sheetHeight).toBe(0);
  });
});
