// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PlannerDrawerHeader } from "@/components/map/route/PlannerDrawerHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HEIGHT_PROPERTY = "--curated-walk-header-height";

let drawer: HTMLDivElement;
let root: Root;
let headHeight: number;
let resize: () => void;

function render(title?: string) {
  act(() => root.render(createElement(PlannerDrawerHeader, {
    title, kicker: "Festive West End", drag: {},
    navigation: { backLabel: null, onHome: () => {}, homeLabel: "Close the walk" },
  })));
}

beforeEach(() => {
  headHeight = 54;
  resize = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() { resize = () => {}; }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: this.classList.contains("plannerSheetHead") ? headHeight : 0 } as DOMRect;
  });
  // The drawer wraps its content, so the head is not the drawer's own child.
  drawer = document.createElement("div");
  drawer.className = "mapDrawer left open";
  const content = document.createElement("div");
  drawer.append(content);
  document.body.append(drawer);
  root = createRoot(content);
});
afterEach(() => {
  act(() => root.unmount());
  drawer.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("gives the scrolling drawer the height of a walk's pinned title, and follows it when the title wraps", () => {
  render("London Christmas walk");
  expect(drawer.style.getPropertyValue(HEIGHT_PROPERTY)).toBe("54px");

  headHeight = 92;
  act(() => resize());
  expect(drawer.style.getPropertyValue(HEIGHT_PROPERTY)).toBe("92px");
});

it("leaves the drawer alone when no walk title is pinned, and clears the height when the title goes", () => {
  render();
  expect(drawer.style.getPropertyValue(HEIGHT_PROPERTY)).toBe("");

  render("London Christmas walk");
  expect(drawer.style.getPropertyValue(HEIGHT_PROPERTY)).toBe("54px");
  render();
  expect(drawer.style.getPropertyValue(HEIGHT_PROPERTY)).toBe("");
});
