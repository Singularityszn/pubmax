// @vitest-environment jsdom

// The app-wide night theme. With no stored theme choice, London's night
// (21:30 to 03:59) is dark; otherwise the OS decides; a stored choice always
// wins. The pre-paint script (public/theme-init.js) and lib/themePreference.ts
// state the rule twice, because the script runs before any module, so this
// file runs the script's own bytes against the module. ThemeAttribute follows
// the clock while a page stays open and stands down when the reader chooses.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ThemeAttribute from "@/components/ThemeAttribute";
import {
  isNightThemeTime,
  NIGHT_THEME_ENDS_MINUTES,
  NIGHT_THEME_STARTS_MINUTES,
  resolveThemePreference,
  THEME_STORAGE_KEY,
} from "@/lib/themePreference";
import { toggleThemeChoice } from "@/lib/useThemeChoice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = document.documentElement;
const THEME_INIT = readFileSync(join(process.cwd(), "public", "theme-init.js"), "utf8");

let systemDark = false;

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-color-scheme: dark") ? systemDark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function resetDocument(): void {
  window.localStorage.clear();
  for (const key of ["theme", "nightTheme", "themeChosen", "legacy", "mode"]) delete html.dataset[key];
}

beforeEach(() => {
  vi.useFakeTimers();
  systemDark = false;
  stubMatchMedia();
  resetDocument();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetDocument();
});

// Friday 30 October 2026 is GMT, so a Z instant is the London wall clock;
// Monday 31 August 2026 is BST, an hour ahead of Z.
const GMT = (hhmm: string) => new Date(`2026-10-30T${hhmm}:00Z`);

describe("the night window", () => {
  it("is 21:30 to 03:59 London time, in winter and in summer", () => {
    expect(NIGHT_THEME_STARTS_MINUTES).toBe(21 * 60 + 30);
    expect(NIGHT_THEME_ENDS_MINUTES).toBe(4 * 60);
    expect(isNightThemeTime(GMT("21:29"))).toBe(false);
    expect(isNightThemeTime(GMT("21:30"))).toBe(true);
    expect(isNightThemeTime(new Date("2026-10-31T03:59:00Z"))).toBe(true);
    expect(isNightThemeTime(new Date("2026-10-31T04:00:00Z"))).toBe(false);
    // 20:30 UTC in August is 21:30 in London.
    expect(isNightThemeTime(new Date("2026-08-31T20:30:00Z"))).toBe(true);
    expect(isNightThemeTime(new Date("2026-08-31T20:29:00Z"))).toBe(false);
  });

  it("puts a stored choice first, the night second and the OS last", () => {
    const night = GMT("22:45");
    const day = GMT("14:00");
    expect(resolveThemePreference("light", true, night)).toBe("light");
    expect(resolveThemePreference("dark", false, day)).toBe("dark");
    expect(resolveThemePreference(null, false, night)).toBe("dark");
    expect(resolveThemePreference(null, false, day)).toBe("light");
    expect(resolveThemePreference(null, true, day)).toBe("dark");
  });
});

describe("the pre-paint script says the same", () => {
  function runThemeInit(at: Date): void {
    vi.setSystemTime(at);
    new Function(THEME_INIT)();
  }

  it.each([
    ["21:29", false, null, "light", false],
    ["21:30", false, null, "dark", true],
    ["03:59", false, null, "dark", true],
    ["04:00", false, null, "light", false],
    ["14:00", true, null, "dark", false],
    ["22:45", false, "light", "light", false],
    ["14:00", false, "dark", "dark", false],
  ] as const)("at %s (OS dark %s, stored %s) it paints %s", (hhmm, osDark, stored, theme, nightMarker) => {
    systemDark = osDark;
    if (stored) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    const at = hhmm < "12:00" ? new Date(`2026-10-31T${hhmm}:00Z`) : GMT(hhmm);
    runThemeInit(at);
    expect(html.dataset.theme).toBe(theme);
    expect(html.dataset.nightTheme === "1").toBe(nightMarker);
    // The module agrees with the script at every case.
    expect(resolveThemePreference(stored, osDark, at)).toBe(theme);
  });
});

describe("the pre-paint script when storage refuses the read", () => {
  // Blocked site data can throw on the localStorage getter itself, or on
  // getItem. Neither is a stored choice, so the night rule must still paint.
  function withStorage(descriptor: PropertyDescriptor, run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, ...descriptor });
    try {
      run();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }

  it.each([
    ["a throwing getter", { get: () => { throw new DOMException("blocked", "SecurityError"); } }],
    ["a throwing getItem", { value: { getItem: () => { throw new DOMException("blocked", "SecurityError"); } } }],
  ] as const)("paints dark at 22:45 with %s and a light system", (_name, descriptor) => {
    systemDark = false;
    vi.setSystemTime(GMT("22:45"));
    withStorage(descriptor, () => new Function(THEME_INIT)());
    expect(html.dataset.theme).toBe("dark");
    expect(html.dataset.nightTheme).toBe("1");
  });

  it("follows the system by day when storage refuses the read", () => {
    systemDark = true;
    vi.setSystemTime(GMT("14:00"));
    withStorage({ get: () => { throw new DOMException("blocked", "SecurityError"); } }, () => new Function(THEME_INIT)());
    expect(html.dataset.theme).toBe("dark");
    expect(html.dataset.nightTheme).toBeUndefined();
  });
});

describe("ThemeAttribute follows the clock while the page is open", () => {
  let container: HTMLDivElement;
  let root: Root;

  function mountAt(at: Date): void {
    vi.setSystemTime(at);
    new Function(THEME_INIT)();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(ThemeAttribute)));
  }

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function minutes(count: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(count * 60_000);
    });
  }

  it("turns dark at 21:30 and light again at 04:00 without a reload", async () => {
    mountAt(GMT("21:28"));
    expect(html.dataset.theme).toBe("light");
    await minutes(2);
    expect(html.dataset.theme).toBe("dark");
    expect(html.dataset.nightTheme).toBe("1");
    vi.setSystemTime(new Date("2026-10-31T03:59:30Z"));
    await minutes(1);
    expect(html.dataset.theme).toBe("light");
    expect(html.dataset.nightTheme).toBeUndefined();
  });

  it("catches up when a slept tab comes back", async () => {
    mountAt(GMT("20:00"));
    expect(html.dataset.theme).toBe("light");
    vi.setSystemTime(GMT("22:10"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(html.dataset.theme).toBe("dark");
  });

  it("never touches a stored choice", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    mountAt(GMT("21:28"));
    await minutes(5);
    expect(html.dataset.theme).toBe("light");
    expect(html.dataset.nightTheme).toBeUndefined();
  });

  it("stands down when the reader taps the theme control, even if storage refuses it", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    mountAt(GMT("22:00"));
    expect(html.dataset.theme).toBe("dark");
    // Light, then dark, then light again: the reader's last word is light.
    act(() => toggleThemeChoice());
    act(() => toggleThemeChoice());
    act(() => toggleThemeChoice());
    expect(html.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(html.dataset.nightTheme).toBeUndefined();
    await minutes(10);
    expect(html.dataset.theme).toBe("light");
    // And at 04:00 it does not flip a chosen dark either.
    act(() => toggleThemeChoice());
    vi.setSystemTime(new Date("2026-10-31T04:01:00Z"));
    await minutes(1);
    expect(html.dataset.theme).toBe("dark");
  });
});
