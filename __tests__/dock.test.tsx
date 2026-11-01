// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Dock from Motion Primitives, as the house rules rebuilt it
// (components/ui/dock.tsx): real controls inside presentational items, launch
// tokens instead of palette classes, a 44px resting item, and magnification
// only for a hovering fine pointer with motion allowed.

let host: HTMLDivElement;
let root: Root | null = null;

function stubMedia({ finePointer, reducedMotion }: { finePointer: boolean; reducedMotion: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion")
      ? reducedMotion
      : query.includes("pointer: fine")
        ? finePointer
        : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

// framer-motion reads the reduced-motion preference once per module, so each
// case loads a fresh copy of the dock after its media stub is in place.
async function loadDemo(): Promise<ComponentType> {
  vi.resetModules();
  const demo = await import("@/components/ui/dock-demo");
  return demo.AppleStyleDock;
}

async function render(media: { finePointer: boolean; reducedMotion: boolean }) {
  stubMedia(media);
  const AppleStyleDock = await loadDemo();
  root = createRoot(host);
  await act(async () => root?.render(createElement(AppleStyleDock)));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

describe("the Dock primitive", () => {
  it("wraps real, named links and never a div that plays a button", async () => {
    await render({ finePointer: true, reducedMotion: false });
    const toolbar = host.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute("aria-label")).toBe("Application dock");
    const links = [...host.querySelectorAll<HTMLAnchorElement>("[data-dock-item] a[href]")];
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Home",
      "Products",
      "Components",
      "Activity",
      "Change Log",
      "Email",
      "Theme",
    ]);
    expect(host.querySelector('[role="button"]')).toBeNull();
    expect(host.querySelector("[aria-haspopup]")).toBeNull();
    expect(host.querySelector("[tabindex]")).toBeNull();
  });

  it("rests every item at the 44px tap floor", async () => {
    await render({ finePointer: true, reducedMotion: false });
    const items = [...host.querySelectorAll<HTMLElement>("[data-dock-item]")];
    expect(items).toHaveLength(7);
    for (const item of items) expect(item.style.width).toBe("44px");
  });

  it("shows an item's label when its control takes focus, hidden from the reader", async () => {
    await render({ finePointer: true, reducedMotion: false });
    const first = host.querySelector<HTMLAnchorElement>("[data-dock-item] a[href]");
    expect(host.textContent).not.toContain("Home");
    await act(async () => first?.focus());
    const label = [...host.querySelectorAll<HTMLElement>("[data-dock-item] > span")].find(
      (node) => node.textContent === "Home",
    );
    expect(label).toBeDefined();
    expect(label?.getAttribute("aria-hidden")).toBe("true");
  });

  it("moves focus along the row with Left, Right, Home and End", async () => {
    await render({ finePointer: true, reducedMotion: false });
    const links = [...host.querySelectorAll<HTMLAnchorElement>("[data-dock-item] a[href]")];
    const press = async (key: string) => {
      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    };
    await act(async () => links[0]?.focus());
    await press("ArrowRight");
    expect(document.activeElement).toBe(links[1]);
    await press("ArrowLeft");
    await press("ArrowLeft");
    expect(document.activeElement).toBe(links[6]);
    await press("Home");
    expect(document.activeElement).toBe(links[0]);
    await press("End");
    expect(document.activeElement).toBe(links[6]);
  });

  it("magnifies only for a hovering fine pointer with motion allowed", async () => {
    await render({ finePointer: true, reducedMotion: false });
    expect(host.querySelector("[data-dock-magnifies]")).not.toBeNull();
  });

  it("keeps every item at rest under reduced motion", async () => {
    await render({ finePointer: true, reducedMotion: true });
    expect(host.querySelector("[data-dock-magnifies]")).toBeNull();
    const item = host.querySelector<HTMLElement>("[data-dock-item]");
    await act(async () => {
      item?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 30 }));
    });
    expect(item?.style.width).toBe("44px");
  });

  it("keeps every item at rest on a touch screen", async () => {
    await render({ finePointer: false, reducedMotion: false });
    expect(host.querySelector("[data-dock-magnifies]")).toBeNull();
  });

  it("reads launch tokens, never Tailwind's palette or its OS-driven dark variant", () => {
    for (const file of ["components/ui/dock.tsx", "components/ui/dock-demo.tsx"]) {
      // The rules are about code, so the comments that explain them are not read.
      const source = readFileSync(join(process.cwd(), file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/\b(?:bg|text|border)-(?:gray|neutral|zinc|slate)-\d/);
      expect(source, file).not.toMatch(/\bdark:/);
      expect(source, file).not.toMatch(/rounded-2xl/);
      expect(source, file).not.toMatch(/role=["']button["']/);
    }
  });
});
