// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DrinkLaneTapHandles from "@/components/map/DrinkLaneTapHandles";
import { drinkLaneIcon } from "@/components/map/drinkLaneIcons";
import { MAP_DRINK_LANES } from "@/lib/drinkLanes";
import { DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";

// The desktop drink picker's tap handles stand in for its chips, so they keep
// the chips' contract: the browser specs find the lanes by the group's name,
// each button by its lane's label, and all eleven on one row by class.

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

function render(lane: DrinkCategory, onChange: (lane: DrinkCategory) => void = () => {}) {
  root = createRoot(host);
  act(() => root?.render(createElement(DrinkLaneTapHandles, { lane, onChange })));
}

describe("the drink picker's tap handles", () => {
  it("keeps the chips' group, names and pressed state", () => {
    render("wine");
    const group = host.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Drink prices shown on the map");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.drinkLanePickerOption")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(
      MAP_DRINK_LANES.map((lane) => lane.label),
    );
    const pressed = buttons.filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed.map((button) => button.getAttribute("aria-label"))).toEqual(["Wine"]);
    expect(pressed[0]?.classList.contains("isSelected")).toBe(true);
  });

  it("shows the selected lane's word without a pointer on it", () => {
    render("cocktail");
    const visibleLabels = [...host.querySelectorAll("[data-dock-item] > span[aria-hidden='true']")]
      .map((node) => node.textContent)
      .filter(Boolean);
    expect(visibleLabels).toEqual(["Cocktails"]);
  });

  it("hands the tapped lane to the map", () => {
    const onChange = vi.fn();
    render("beer", onChange);
    const gin = host.querySelector<HTMLButtonElement>('button[aria-label="Gin"]');
    act(() => gin?.click());
    expect(onChange).toHaveBeenCalledWith("gin");
  });

  it("gives every drink category a handle icon", () => {
    for (const category of DRINK_CATEGORIES) expect(drinkLaneIcon(category), category).toBeTruthy();
  });

  it("keeps framer-motion off the map's first load", () => {
    const picker = readFileSync(join(process.cwd(), "components/map/DrinkLanePicker.tsx"), "utf8");
    expect(picker).not.toMatch(/from "@\/components\/ui\/dock"/);
    expect(picker).not.toMatch(/from "@\/components\/map\/DrinkLaneTapHandles"/);
    expect(picker).toMatch(/import\("@\/components\/map\/DrinkLaneTapHandles"\)/);
  });
});
