// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SpringDrawer from "@/components/map/SpringDrawer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const inertDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  // jsdom needs the browser's reflected inert property for owner behavior.
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  if (inertDescriptor) Object.defineProperty(HTMLElement.prototype, "inert", inertDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "inert");
  vi.unstubAllGlobals();
});

function frame(timestamp: number): void {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(timestamp)));
}

describe.each([700, 768, 769, 900])("drawer at %ipx", (width) => {
  for (const side of ["left", "right"] as const) {
    for (const keepMounted of [false, true]) {
      it(`${side} retains closing content and ${keepMounted ? "keeps" : "removes"} it at rest`, () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
          matches: query.includes("max-width") && width <= Number(query.match(/\d+/)?.[0]),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }));
        const render = (open: boolean, text: string) => act(() => root.render(
          <SpringDrawer
            open={open}
            side={side}
            snap="half"
            dragOffsetY={null}
            releaseVelocityY={0}
            keepMounted={keepMounted}
          >
            {open ? <button>{text}</button> : null}
          </SpringDrawer>,
        ));

        render(true, "First pub");
        const drawer = host.firstElementChild!;
        const content = drawer.firstElementChild!;
        expect(content.hasAttribute("inert")).toBe(false);
        render(true, "Latest pub");
        render(false, "");
        expect(content.hasAttribute("inert")).toBe(true);
        expect(drawer.textContent).toBe("Latest pub");

        frame(0);
        expect(drawer.textContent).toBe("Latest pub");
        frame(5_000);
        expect(drawer.textContent).toBe(keepMounted ? "Latest pub" : "");
        expect(content.hasAttribute("inert")).toBe(true);

        render(true, "Next pub");
        expect(content.hasAttribute("inert")).toBe(false);
        expect(drawer.textContent).toBe("Next pub");
      });
    }
  }
});
