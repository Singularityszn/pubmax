// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const ROOT = join(__dirname, "..");

function plugin(preferred: number, current = 1) {
  return {
    get: vi.fn(async () => ({ value: current })),
    getPreferred: vi.fn(async () => ({ value: preferred })),
    set: vi.fn(async () => {}),
  };
}

afterEach(() => {
  document.documentElement.removeAttribute(TEXT_SCALE_ATTRIBUTE);
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
    const p = plugin(1, 2);
    await expect(
      applyNativeTextScale({ isNative: () => true, platform: () => "android", loadPlugin: async () => p }),
    ).resolves.toEqual({ status: "read", scale: 2 });
    expect(p.set).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
  });

  it("takes the attribute off again at an ordinary size", async () => {
    document.documentElement.setAttribute(TEXT_SCALE_ATTRIBUTE, "large");
    const p = plugin(1, 1);
    await applyNativeTextScale({ isNative: () => true, platform: () => "android", loadPlugin: async () => p });
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

describe("the surfaces that change shape", () => {
  it("is wired from the shell's document marker and drops the tab words at the large bucket", () => {
    const chrome = readFileSync(join(ROOT, "components/native/NativeShellChrome.tsx"), "utf8");
    expect(chrome).toContain("followNativeTextScale()");
    const css = readFileSync(join(ROOT, "components/nav/mobileNav.css"), "utf8");
    expect(css).toContain('html[data-text-scale="large"] .mobileTabLabel');
    // The accessible name lives on the link, so hiding the word costs a screen
    // reader nothing.
    const bar = readFileSync(join(ROOT, "components/nav/MobileTabBar.tsx"), "utf8");
    expect(bar).toContain("aria-label={tab.ariaLabel}");
    // The consent card grows past its phone ceiling rather than clipping the
    // disclosure and the way out.
    const globals = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    expect(globals).toContain('html[data-text-scale="large"] .analyticsConsentPrompt {');
    expect(globals).toMatch(/html\[data-text-scale="large"\] \.analyticsConsentPrompt \{[^}]*max-height: none;/);
  });
});
