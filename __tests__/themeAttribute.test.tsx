// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ThemeAttribute from "@/components/ThemeAttribute";
import { BROWSER_BAR_COLOR } from "@/lib/browserBarColor";
import { THEME_STORAGE_KEY } from "@/lib/themePreference";
import { LEGACY_STORAGE_KEY, MODE_STORAGE_KEY } from "@/lib/viewMode";

// A segment not-found (/crawls/nope, /recap/abc, /plan/nope) is rendered on the
// client, so public/theme-init.js never ran and <html> has no data-theme,
// data-legacy or data-mode. A person in dark then read a light page (QA
// journeys report F15), and a Legacy Mode reader lost the larger type.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(strictMode = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const component = createElement(ThemeAttribute);
  act(() => root.render(strictMode ? createElement(StrictMode, null, component) : component));
  return () => act(() => root.unmount());
}

function clearRoot() {
  const { dataset } = document.documentElement;
  delete dataset.theme;
  delete dataset.legacy;
  delete dataset.mode;
  for (const name of ["--font-display", "--font-body", "--font-data", "padding"]) {
    document.documentElement.style.removeProperty(name);
  }
}

describe("ThemeAttribute", () => {
  beforeEach(() => {
    clearRoot();
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });
  afterEach(clearRoot);

  // The root layout no longer pins the fonts to their fallbacks, so this
  // component owns no font state and must not touch any (17 Oct 2026).
  it("leaves every font and unrelated style on <html> as it found it", () => {
    const root = document.documentElement;
    root.style.setProperty("--font-display", "another-display-owner");
    root.style.setProperty("--font-data", "numeric-owner");
    root.style.padding = "8px";
    mount()();
    expect(root.style.getPropertyValue("--font-display")).toBe("another-display-owner");
    expect(root.style.getPropertyValue("--font-data")).toBe("numeric-owner");
    expect(root.style.padding).toBe("8px");
  });

  it("restores theme state through StrictMode and a root remount", () => {
    const root = document.documentElement;
    mount(true)();
    delete root.dataset.theme;
    delete root.dataset.mode;
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(LEGACY_STORAGE_KEY, "1");
    mount()();
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.legacy).toBe("1");
    expect(root.dataset.mode).toBe("ledger");
  });

  it("restores the stored choice when the attribute is missing", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    mount()();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the OS when nothing is stored", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    mount()();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("never overrides a theme the no-flash script already set", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.dataset.theme = "light";
    mount()();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("gives a Legacy Mode reader on a client-rendered 404 the Ledger view back", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "1");
    mount()();
    expect(document.documentElement.dataset.legacy).toBe("1");
    expect(document.documentElement.dataset.mode).toBe("ledger");
  });

  it("turns Legacy Mode on for a stored Ledger view", () => {
    localStorage.setItem(MODE_STORAGE_KEY, "ledger");
    mount()();
    expect(document.documentElement.dataset.legacy).toBe("1");
    expect(document.documentElement.dataset.mode).toBe("ledger");
  });

  it("defaults to Lock-In with standard type when nothing is stored", () => {
    mount()();
    expect(document.documentElement.dataset.legacy).toBeUndefined();
    expect(document.documentElement.dataset.mode).toBe("lock-in");
  });

  it("keeps Legacy Mode under an explicit Lock-In view, as the no-flash script does", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "1");
    localStorage.setItem(MODE_STORAGE_KEY, "lock-in");
    mount()();
    expect(document.documentElement.dataset.legacy).toBe("1");
    expect(document.documentElement.dataset.mode).toBe("lock-in");
  });

  it("never overrides a view the no-flash script already set", () => {
    localStorage.setItem(MODE_STORAGE_KEY, "ledger");
    document.documentElement.dataset.mode = "lock-in";
    mount()();
    expect(document.documentElement.dataset.mode).toBe("lock-in");
    expect(document.documentElement.dataset.legacy).toBeUndefined();
  });

  // The viewport's two theme-color tags follow the OS scheme. A reader who
  // picks dark in the app on a light phone must still get the dark bar.
  it("paints both browser-bar tags in the in-app theme, and follows a toggle", () => {
    const tags = ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"].map((media) => {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.media = media;
      meta.content = "#000000";
      document.head.appendChild(meta);
      return meta;
    });
    document.documentElement.dataset.theme = "dark";
    const unmount = mount();
    expect(tags.map((tag) => tag.content)).toEqual([BROWSER_BAR_COLOR.dark, BROWSER_BAR_COLOR.dark]);

    act(() => {
      document.documentElement.dataset.theme = "light";
    });
    return Promise.resolve().then(() => {
      expect(tags.map((tag) => tag.content)).toEqual([BROWSER_BAR_COLOR.light, BROWSER_BAR_COLOR.light]);
      unmount();
      for (const tag of tags) tag.remove();
    });
  });
});
