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
  return null;
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
