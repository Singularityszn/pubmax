// The covered strip at the foot of the layout viewport (lib/keyboardInset.ts).
//
// A phone browser does not shrink the layout viewport for the keyboard, so a
// composer pinned to `bottom: 0` was pinned behind the keys. The inset is the
// pure arithmetic over the visual viewport's own readings, and the store
// around it attaches nothing until somebody subscribes.

import { describe, expect, it, vi } from "vitest";

import {
  keyboardInsetPx,
  readKeyboardInset,
  readKeyboardViewportBounds,
  serverKeyboardInset,
  subscribeKeyboardInset,
} from "@/lib/keyboardInset";

describe("keyboardInsetPx", () => {
  it("is what the visual viewport does not reach, from the bottom", () => {
    // iPhone 13: an 844px layout viewport, a 336px keyboard, nothing scrolled.
    expect(keyboardInsetPx({ layoutHeight: 844, viewportHeight: 508, offsetTop: 0 })).toBe(336);
  });

  it("counts the visible part's own offset, the way iOS reports a pushed page", () => {
    expect(keyboardInsetPx({ layoutHeight: 844, viewportHeight: 508, offsetTop: 100 })).toBe(236);
  });

  it("is zero where nothing is covered, and never negative", () => {
    expect(keyboardInsetPx({ layoutHeight: 844, viewportHeight: 844, offsetTop: 0 })).toBe(0);
    // A browser that shrank the layout viewport itself (desktop, emulation).
    expect(keyboardInsetPx({ layoutHeight: 480, viewportHeight: 480, offsetTop: 0 })).toBe(0);
    expect(keyboardInsetPx({ layoutHeight: 480, viewportHeight: 500, offsetTop: 0 })).toBe(0);
  });

  it("is whole pixels, so a pinned bar cannot shimmer on a fractional reading", () => {
    expect(keyboardInsetPx({ layoutHeight: 844, viewportHeight: 507.6, offsetTop: 0.2 })).toBe(336);
  });

  it("answers zero for a reading that is not a number", () => {
    expect(keyboardInsetPx({ layoutHeight: Number.NaN, viewportHeight: 500, offsetTop: 0 })).toBe(0);
    expect(keyboardInsetPx({ layoutHeight: 844, viewportHeight: Infinity, offsetTop: 0 })).toBe(0);
  });
});

describe("the store", () => {
  it("answers zero on the server and before anybody subscribes", () => {
    expect(serverKeyboardInset()).toBe(0);
    expect(readKeyboardInset()).toBe(0);
  });

  it("subscribes and unsubscribes without a visual viewport to read", () => {
    // jsdom has no visualViewport; the store must attach nothing and answer 0.
    const unsubscribe = subscribeKeyboardInset(() => {});
    expect(readKeyboardInset()).toBe(0);
    expect(() => unsubscribe()).not.toThrow();
  });

  // THE HELD FIGURE IS A MEMORY ONCE NOBODY IS LISTENING. `readKeyboardInset`
  // is the `getSnapshot` for `useSyncExternalStore`, so a thread remounted
  // after the keyboard closed would paint the old inset for one frame.
  it("forgets the inset when the last subscriber leaves", () => {
    const noop = () => {};
    vi.stubGlobal("window", {
      innerHeight: 768,
      addEventListener: noop,
      removeEventListener: noop,
      visualViewport: {
        height: 468,
        offsetTop: 0,
        addEventListener: noop,
        removeEventListener: noop,
      },
    });
    try {
      const unsubscribe = subscribeKeyboardInset(() => {});
      expect(readKeyboardInset()).toBe(300);
      unsubscribe();
      expect(readKeyboardInset()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


it("notifies visible-bound changes even when the composer bottom inset stays constant", () => {
  const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
  viewport.height = 508;
  viewport.offsetTop = 100;
  const layout = new EventTarget();
  vi.stubGlobal("window", {
    innerHeight: 844,
    visualViewport: viewport,
    addEventListener: layout.addEventListener.bind(layout),
    removeEventListener: layout.removeEventListener.bind(layout),
  });
  let unsubscribe = () => {};
  try {
    const changed = vi.fn();
    unsubscribe = subscribeKeyboardInset(changed);
    expect(readKeyboardViewportBounds()).toEqual({ offsetTop: 100, height: 508 });
    expect(readKeyboardInset()).toBe(236);
    changed.mockClear();
    viewport.offsetTop = 140;
    viewport.height = 468;
    viewport.dispatchEvent(new Event("scroll"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(readKeyboardViewportBounds()).toEqual({ offsetTop: 140, height: 468 });
    expect(readKeyboardInset()).toBe(236);
  } finally {
    unsubscribe();
    vi.unstubAllGlobals();
  }
  expect(readKeyboardViewportBounds()).toEqual({ offsetTop: 0, height: null });
});
