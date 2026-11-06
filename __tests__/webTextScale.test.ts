// @vitest-environment jsdom
// The browser's own text size publishes the same large-text bucket the native
// shell publishes from the OS size (lib/nativeTextScale.ts). Design review,
// 6 Nov 2026: at 200 percent browser text the phone tab bar broke "Explore"
// and "Tonight" inside the word, while the shell already answered the same
// size with icons alone. public/theme-init.js decides it before first paint.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LARGE_TEXT_SCALE_FLOOR, TEXT_SCALE_ATTRIBUTE } from "@/lib/nativeTextScale";

const themeInit = readFileSync(join(process.cwd(), "public/theme-init.js"), "utf8");

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
    document.documentElement.removeAttribute(TEXT_SCALE_ATTRIBUTE);
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

  it("writes the floor as the same number lib/nativeTextScale.ts holds", () => {
    expect(themeInit).toContain(`root / 16 >= ${LARGE_TEXT_SCALE_FLOOR})`);
  });
});
