// @vitest-environment jsdom

// Last orders is dark at night by default, and the reader's own theme choice
// always wins. Nothing is stored, and the page goes back when the moment ends.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/themePreference";
import { useNightDarkTheme } from "@/lib/useNightDarkTheme";
import { toggleThemeChoice } from "@/lib/useThemeChoice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const html = document.documentElement;

function Probe({ active }: { active: boolean }) {
  useNightDarkTheme(active);
  return null;
}

function render(active: boolean): void {
  act(() => root.render(createElement(Probe, { active })));
}

beforeEach(() => {
  window.localStorage.clear();
  delete html.dataset.theme;
  delete html.dataset.nightTheme;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useNightDarkTheme", () => {
  it("wears dark while active with no choice, then goes back, storing nothing", () => {
    html.dataset.theme = "light";
    render(true);
    expect(html.dataset.theme).toBe("dark");
    expect(html.dataset.nightTheme).toBe("1");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    render(false);
    expect(html.dataset.theme).toBe("light");
    expect(html.dataset.nightTheme).toBeUndefined();
  });

  it("puts back a page that had no theme attribute", () => {
    render(true);
    expect(html.dataset.theme).toBe("dark");
    act(() => root.unmount());
    root = createRoot(container);
    expect(html.dataset.theme).toBeUndefined();
  });

  it("never overrides a stored choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    html.dataset.theme = "light";
    render(true);
    expect(html.dataset.theme).toBe("light");
    expect(html.dataset.nightTheme).toBeUndefined();
  });

  it("leaves a page already dark alone, and does not mark it", () => {
    html.dataset.theme = "dark";
    render(true);
    render(false);
    expect(html.dataset.theme).toBe("dark");
    expect(html.dataset.nightTheme).toBeUndefined();
  });

  it("keeps a choice the reader makes while it is dark", () => {
    html.dataset.theme = "light";
    render(true);
    expect(html.dataset.theme).toBe("dark");
    // The reader taps the theme toggle: that is a choice, and it stands.
    act(() => toggleThemeChoice());
    expect(html.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    render(false);
    expect(html.dataset.theme).toBe("light");
    expect(html.dataset.nightTheme).toBeUndefined();
  });
});
