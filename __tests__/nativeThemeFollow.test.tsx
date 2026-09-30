// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  resolveThemePreference,
  storedThemePreference,
} from "@/lib/themePreference";

// THE SHELL FOLLOWS THE OS APPEARANCE WHILE THE APP IS OPEN.
//
// public/theme-init.js decides the theme once before paint. On the web that
// is the whole story; in the native shell a phone that flips to dark at
// sunset does so with the app on screen, and a light page under a light
// status bar until the next cold start reads as a website somebody wrapped.
// Measured: docs/proof/mobile-app-design/ios-sim-iphone17pro/tonight/
// os-dark-while-open.png.

const syncNativeSystemBars = vi.fn<(theme: string) => Promise<boolean>>(async () => true);
const isNativeApp = vi.fn(() => true);
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => isNativeApp() }));
vi.mock("@/lib/nativeSystemBars", () => ({
  syncNativeSystemBars: (theme: string) => syncNativeSystemBars(theme),
}));

type Listener = (event: { matches: boolean }) => void;

function installMatchMedia(initialDark: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => query),
  });
  return {
    flip(dark: boolean) {
      query.matches = dark;
      for (const listener of listeners) listener({ matches: dark });
    },
    listenerCount: () => listeners.size,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount() {
  const { default: NativeSystemBars } = await import("@/components/native/NativeSystemBars");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(NativeSystemBars));
  });
}

// Node 26's jsdom shadows window.localStorage as undefined (the shape PR 1583
// fixes for the suite); a small stub keeps this file honest on either Node.
const memoryStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => memoryStorage.set(key, String(value)),
    removeItem: (key: string) => memoryStorage.delete(key),
    clear: () => memoryStorage.clear(),
    key: () => null,
    get length() {
      return memoryStorage.size;
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  isNativeApp.mockReturnValue(true);
  memoryStorage.clear();
  document.documentElement.dataset.theme = "light";
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  host?.remove();
  root = null;
  host = null;
});

describe("the theme preference leaf", () => {
  it("reads only a real choice off the one key, and never throws", () => {
    expect(storedThemePreference(null)).toBeNull();
    expect(storedThemePreference({ getItem: () => "sepia" })).toBeNull();
    expect(storedThemePreference({ getItem: () => "dark" })).toBe("dark");
    expect(
      storedThemePreference({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
    expect(THEME_STORAGE_KEY).toBe("pubmax-theme");
  });

  it("lets a stored choice win and the OS decide only without one", () => {
    expect(resolveThemePreference(null, true)).toBe("dark");
    expect(resolveThemePreference(null, false)).toBe("light");
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });
});

describe("NativeSystemBars inside the shell", () => {
  it("flips the document with the OS when the person never chose a theme", async () => {
    const media = installMatchMedia(false);
    await mount();
    expect(syncNativeSystemBars).toHaveBeenLastCalledWith("light");

    await act(async () => media.flip(true));
    expect(document.documentElement.dataset.theme).toBe("dark");
    // The MutationObserver re-syncs the bars off the attribute; a microtask
    // later than the flip.
    await act(async () => {});
    expect(syncNativeSystemBars).toHaveBeenLastCalledWith("dark");

    await act(async () => media.flip(false));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps the person's own choice whatever the OS does", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const media = installMatchMedia(false);
    await mount();
    await act(async () => media.flip(true));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("subscribes only inside the shell and lets go on unmount", async () => {
    isNativeApp.mockReturnValue(false);
    const web = installMatchMedia(false);
    await mount();
    expect(web.listenerCount()).toBe(0);
    expect(syncNativeSystemBars).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    root = null;

    isNativeApp.mockReturnValue(true);
    const shell = installMatchMedia(false);
    await mount();
    expect(shell.listenerCount()).toBe(1);
    await act(async () => root!.unmount());
    root = null;
    expect(shell.listenerCount()).toBe(0);
  });
});
