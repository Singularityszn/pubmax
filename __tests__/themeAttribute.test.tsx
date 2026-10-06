// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ThemeAttribute from "@/components/ThemeAttribute";
import { THEME_STORAGE_KEY } from "@/lib/themePreference";
import { LEGACY_STORAGE_KEY, MODE_STORAGE_KEY } from "@/lib/viewMode";

// A segment not-found (/crawls/nope, /recap/abc, /plan/nope) is rendered on the
// client, so public/theme-init.js never ran and <html> has no data-theme,
// data-legacy or data-mode. A person in dark then read a light page (QA
// journeys report F15), and a Legacy Mode reader lost the larger type.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ThemeAttribute)));
  return () => act(() => root.unmount());
}

function clearRoot() {
  const { dataset } = document.documentElement;
  delete dataset.theme;
  delete dataset.legacy;
  delete dataset.mode;
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
});
