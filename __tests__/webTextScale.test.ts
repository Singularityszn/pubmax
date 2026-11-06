// @vitest-environment jsdom
// The browser's own text size publishes the same large-text bucket the native
// shell publishes from the OS size (lib/nativeTextScale.ts). Design review,
// 6 Nov 2026: at 200 percent browser text the phone tab bar broke "Explore"
// and "Tonight" inside the word, while the shell already answered the same
// size with icons alone. public/theme-init.js decides it before first paint.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ThemeAttribute from "@/components/ThemeAttribute";
import { LARGE_TEXT_SCALE_FLOOR, TEXT_SCALE_ATTRIBUTE } from "@/lib/nativeTextScale";

const themeInit = readFileSync(join(process.cwd(), "public/theme-init.js"), "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ThemeAttribute)));
  unmount = () => {
    act(() => root.unmount());
    host.remove();
    unmount = undefined;
  };
}

function runThemeInit(rootFontPx: number, native = false) {
  new Function("window", themeInit)({
    location: { pathname: "/tonight", search: "", hash: "", replace: () => {} },
    localStorage,
    sessionStorage,
    matchMedia: () => ({ matches: false }),
    navigator: { webdriver: false },
    getComputedStyle: () => ({ fontSize: `${rootFontPx}px` }),
    ...(native ? { Capacitor: { isNativePlatform: () => true } } : {}),
  });
}

afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("font-size");
  document.documentElement.removeAttribute(TEXT_SCALE_ATTRIBUTE);
});

describe("the browser text size bucket in public/theme-init.js", () => {
  it("marks a browser default of 200 percent as large", () => {
    runThemeInit(32);
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
  });

  it("starts the large bucket at the native floor and not below it", () => {
    runThemeInit(16 * LARGE_TEXT_SCALE_FLOOR);
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
    runThemeInit(16 * LARGE_TEXT_SCALE_FLOOR - 0.5);
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });

  it("leaves the default text size alone", () => {
    runThemeInit(16);
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });

  it("leaves the native shell to publish its own scale", () => {
    runThemeInit(32, true);
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });
});

describe("the mounted browser text size lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.documentElement.style.fontSize = "16px";
  });

  it.each([
    [32, "large"],
    [16, null],
  ] as const)("reconciles a %ipx root on mount", (fontSize, expected) => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    if (expected === null) document.documentElement.setAttribute(TEXT_SCALE_ATTRIBUTE, "large");
    mount();
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(expected);
  });

  it.each(["pageshow", "visibilitychange"])("sets and clears the bucket on %s", (event) => {
    mount();
    const target = event === "pageshow" ? window : document;
    document.documentElement.style.fontSize = "32px";
    target.dispatchEvent(new Event(event));
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
    document.documentElement.style.fontSize = `${16 * LARGE_TEXT_SCALE_FLOOR}px`;
    target.dispatchEvent(new Event(event));
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
    document.documentElement.style.fontSize = `${16 * LARGE_TEXT_SCALE_FLOOR - 0.5}px`;
    target.dispatchEvent(new Event(event));
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });

  it("waits for visible return before reconciling visibility changes", () => {
    mount();
    document.documentElement.style.fontSize = "32px";
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe("large");
  });

  it.each([
    [16, "large"],
    [32, null],
  ] as const)("leaves native scale ownership intact at %ipx", (fontSize, expected) => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    document.documentElement.style.fontSize = `${fontSize}px`;
    if (expected) document.documentElement.setAttribute(TEXT_SCALE_ATTRIBUTE, expected);
    mount();
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(expected);
  });

  it("stops reconciling after unmount", () => {
    mount();
    unmount?.();
    document.documentElement.style.fontSize = "32px";
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.documentElement.hasAttribute(TEXT_SCALE_ATTRIBUTE)).toBe(false);
  });
});
