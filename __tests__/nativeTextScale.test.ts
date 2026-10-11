// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LARGE_TEXT_SCALE_FLOOR,
  MAX_TEXT_SCALE,
  TEXT_SCALE_ATTRIBUTE,
  applyNativeTextScale,
  clampTextScale,
  followNativeTextScale,
  textScaleBucket,
} from "@/lib/nativeTextScale";

// THE SHELL FOLLOWS THE OS TEXT SIZE. iOS's Larger Text did nothing to a page
// set in CSS px; Android's font scale zoomed every label until the six-tab
// bar overflowed. The seam applies the size on iOS, reads it on Android, and
// publishes the bucket the tab bar changes shape on.

function plugin(preferred: number, current = 1) {
  return {
    get: vi.fn(async () => ({ value: current })),
    getPreferred: vi.fn(async () => ({ value: preferred })),
    set: vi.fn(async () => {}),
  };
}

afterEach(() => {
  document.documentElement.removeAttribute(TEXT_SCALE_ATTRIBUTE);
  document.documentElement.style.removeProperty("--native-text-layout-scale");
});

describe("the pure rules", () => {
  it("clamps what iOS is asked for to Android's own ceiling and never below 1", () => {
    expect(clampTextScale(0.8)).toBe(1);
    expect(clampTextScale(1.35)).toBe(1.35);
    expect(clampTextScale(3.1)).toBe(MAX_TEXT_SCALE);
    expect(clampTextScale(Number.NaN)).toBe(1);
  });

  it("buckets the scale at the floor a six-tab bar can no longer word", () => {
    expect(textScaleBucket(1)).toBeNull();
    expect(textScaleBucket(LARGE_TEXT_SCALE_FLOOR - 0.01)).toBeNull();
    expect(textScaleBucket(LARGE_TEXT_SCALE_FLOOR)).toBe("large");
    expect(textScaleBucket(2)).toBe("large");
  });
});

describe("applyNativeTextScale", () => {
  it("publishes the iOS layout scale only after WebKit accepts the text size", async () => {
    let accept!: () => void;
    const p = plugin(3.1176470588235294);
    p.set = vi.fn(() => new Promise<void>((resolve) => { accept = resolve; }));
    const applying = applyNativeTextScale({
      isNative: () => true, platform: () => "ios", loadPlugin: async () => p,
    });
    await vi.waitFor(() => expect(p.set).toHaveBeenCalledWith({ value: 2 }));
    expect(document.documentElement.style.getPropertyValue("--native-text-layout-scale")).toBe("");
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
    accept();
    await applying;
    expect(document.documentElement.style.getPropertyValue("--native-text-layout-scale")).toBe("2");
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
  });

  it("does nothing off the shell", async () => {
    const p = plugin(2);
    await expect(applyNativeTextScale({ isNative: () => false, loadPlugin: async () => p })).resolves.toEqual({
      status: "unavailable",
    });
    expect(p.set).not.toHaveBeenCalled();
  });

  it("asks WebKit for the preferred size on iOS, clamped, and publishes the bucket", async () => {
    const p = plugin(3.1);
    await expect(
      applyNativeTextScale({ isNative: () => true, platform: () => "ios", loadPlugin: async () => p }),
    ).resolves.toEqual({ status: "applied", scale: 2 });
    expect(p.set).toHaveBeenCalledWith({ value: 2 });
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
  });

  it("reads the zoom the Android WebView already applies and only publishes", async () => {
    document.documentElement.style.setProperty("--native-text-layout-scale", "2");
    const p = plugin(1, 2);
    await expect(
      applyNativeTextScale({ isNative: () => true, platform: () => "android", loadPlugin: async () => p }),
    ).resolves.toEqual({ status: "read", scale: 2 });
    expect(p.set).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--native-text-layout-scale")).toBe("");
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
  });

  it("takes the attribute off again at an ordinary size", async () => {
    document.documentElement.setAttribute(TEXT_SCALE_ATTRIBUTE, "large");
    const p = plugin(1, 1);
    await applyNativeTextScale({ isNative: () => true, platform: () => "android", loadPlugin: async () => p });
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });

  it("restores ordinary iOS layout when the person reduces their text size", async () => {
    document.documentElement.style.setProperty("--native-text-layout-scale", "2");
    document.documentElement.setAttribute(TEXT_SCALE_ATTRIBUTE, "large");
    const p = plugin(1);
    await applyNativeTextScale({ isNative: () => true, platform: () => "ios", loadPlugin: async () => p });
    expect(p.set).toHaveBeenCalledWith({ value: 1 });
    expect(document.documentElement.style.getPropertyValue("--native-text-layout-scale")).toBe("1");
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });

  it("never throws when the plugin is missing or refuses", async () => {
    await expect(
      applyNativeTextScale({
        isNative: () => true,
        platform: () => "ios",
        loadPlugin: async () => {
          throw new Error("no plugin");
        },
      }),
    ).resolves.toEqual({ status: "unavailable" });
    const refusing = plugin(1.5);
    refusing.set = vi.fn(async () => {
      throw new Error("refused");
    });
    await expect(
      applyNativeTextScale({ isNative: () => true, platform: () => "ios", loadPlugin: async () => refusing }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(document.documentElement.style.getPropertyValue("--native-text-layout-scale")).toBe("");
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });
});

describe("followNativeTextScale", () => {
  it("re-applies when the app comes back to the foreground, and lets go on release", async () => {
    const p = plugin(1.5);
    const release = followNativeTextScale({ isNative: () => true, platform: () => "ios", loadPlugin: async () => p });
    await vi.waitFor(() => expect(p.set).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(p.set).toHaveBeenCalledTimes(2));
    release();
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 10));
    expect(p.set).toHaveBeenCalledTimes(2);
  });
});

