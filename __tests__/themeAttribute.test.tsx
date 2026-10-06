// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ThemeAttribute from "@/components/ThemeAttribute";
import { THEME_STORAGE_KEY } from "@/lib/themePreference";

// A segment not-found (/crawls/nope, /recap/abc, /plan/nope) is rendered on the
// client, so public/theme-init.js never ran and <html> has no data-theme. A
// person in dark then read a light page (QA journeys report F15).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ThemeAttribute)));
  return () => act(() => root.unmount());
}

describe("ThemeAttribute", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });
  afterEach(() => {
    delete document.documentElement.dataset.theme;
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

  it("is mounted in both provider branches of the root layout", () => {
    // The Clerk branch and the plain AuthProvider branch each list the shell
    // components; a branch that forgets this one leaves its 404s themeless.
    const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout.match(/<ThemeAttribute \/>/g)).toHaveLength(2);
  });
});
