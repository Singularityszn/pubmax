// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PourLine from "@/components/plan/PourLine";

// The pour line runs round the Planning button while a plan is made, then
// pours the whole way round once when it lands (components/plan/PourLine.tsx).

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
});

function render(busy: boolean) {
  act(() => root?.render(createElement(PourLine, { busy })));
}

const line = () => host.querySelector<SVGSVGElement>("svg.pourLine");

describe("the pour line", () => {
  it("draws nothing while the control is idle", () => {
    render(false);
    expect(line()).toBeNull();
  });

  it("runs while busy and is hidden from assistive tech", () => {
    render(true);
    expect(line()?.getAttribute("data-pour-line")).toBe("busy");
    expect(line()?.getAttribute("aria-hidden")).toBe("true");
    expect(line()?.classList.contains("isLanding")).toBe(false);
  });

  it("pours once on the same element when the work lands, then goes", () => {
    render(true);
    const running = line();
    render(false);
    expect(line()).toBe(running);
    expect(line()?.getAttribute("data-pour-line")).toBe("landing");
    act(() => vi.advanceTimersByTime(500));
    expect(line()).toBeNull();
  });

  it("spends no coral, no gradient and no glow, and holds still for reduced motion", () => {
    const css = readFileSync(join(process.cwd(), "components/plan/pourLine.css"), "utf8");
    expect(css).not.toMatch(/--brass|--color-accent|gradient|drop-shadow|box-shadow|hue-rotate/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*stroke-dasharray: none/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*animation: pourLineRun/);
  });
});
