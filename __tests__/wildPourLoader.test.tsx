// @vitest-environment jsdom
//
// THE POUR (round-two wild idea 04): with the wild switch on, the shared pint
// loader draws a pour instead of its glass (components/wild/PourLoader.tsx).
// The loader keeps its box, its label and its silence to assistive tech, the
// drawing at rest is a full glass, and with the switch off nothing changes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import MapLoadingFrame from "@/components/map/MapLoadingFrame";
import RouteLoadingShell from "@/components/nav/RouteLoadingShell";
import PintLoader from "@/components/ui/pint-loader";
import { WILD_MODE_STORAGE_KEY } from "@/lib/wildMode";

const CSS_PATH = join(process.cwd(), "components/wild/pourLoader.css");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.localStorage.clear();
});

function render(element: ReactElement): void {
  act(() => root.render(element));
}

function idsIn(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? "");
}

function urlRefsIn(html: string): string[] {
  return [...html.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1] ?? "");
}

describe("the pint loader with the wild switch off", () => {
  it("draws the classic glass and no pour", () => {
    render(createElement(PintLoader, { label: "Out" }));
    expect(host.querySelector(".pintLoaderFill")).not.toBeNull();
    expect(host.querySelector(".pourGlass")).toBeNull();
  });

  it("renders the same markup on the server whatever pint is asked for", () => {
    expect(renderToStaticMarkup(createElement(PintLoader, { label: "Social", pour: "stout" }))).toBe(
      renderToStaticMarkup(createElement(PintLoader, { label: "Social" })),
    );
  });
});

describe("the pint loader with the wild switch on", () => {
  beforeEach(() => {
    window.localStorage.setItem(WILD_MODE_STORAGE_KEY, "1");
  });

  it("pours a lager in the same box, label and silence", () => {
    render(createElement(PintLoader, { label: "Out", size: "sm", className: "routeLoadingShellLabel" }));
    const loader = host.querySelector<HTMLElement>(".pintLoader");
    expect(loader?.className).toBe("pintLoader pintLoader--sm routeLoadingShellLabel");
    const glass = host.querySelector("svg");
    expect(glass?.classList.contains("pintLoaderGlass")).toBe(true);
    expect(glass?.classList.contains("pourGlass--lager")).toBe(true);
    expect(glass?.getAttribute("aria-hidden")).toBe("true");
    expect(glass?.getAttribute("viewBox")).toBe("0 0 80 112");
    expect(host.querySelector(".pintLoaderFill")).toBeNull();
    expect(host.innerHTML).not.toContain("role=");
    expect(host.innerHTML).not.toContain("aria-live");
    expect(host.querySelector(".pintLoaderLabel")?.textContent).toBe("Out");
    expect(glass?.textContent).toBe("");
  });

  it("pours a stout where the caller asks for one", () => {
    render(createElement(PintLoader, { pour: "stout" }));
    expect(host.querySelector("svg.pourGlass--stout")).not.toBeNull();
    expect(host.querySelector(".pourSettle")).not.toBeNull();
  });

  it("gives every pour its own gradient and clip, and points each glass at its own", () => {
    render(
      createElement("div", null, createElement(PintLoader), createElement(PintLoader, { pour: "stout" })),
    );
    const html = host.innerHTML;
    const ids = idsIn(html);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const glass of html.split("<svg").slice(1)) {
      const own = idsIn(glass);
      const refs = urlRefsIn(glass);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(own).toContain(ref);
    }
  });

  it("pours on the map's held frame and keeps its one announced line", () => {
    render(createElement(MapLoadingFrame, { mapDisplayName: "London", progress: 20 }));
    expect(host.querySelector(".mapLoadingCopy svg.pourGlass--lager")).not.toBeNull();
    const labels = [...host.querySelectorAll("[aria-label]")].map((node) => node.getAttribute("aria-label"));
    expect(labels).toEqual(["Loading the London pub map."]);
  });
});

describe("the route loading shell", () => {
  function flatten(node: ReactNode): ReactElement[] {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (!isValidElement(node)) return [];
    const element = node as ReactElement<{ children?: ReactNode }>;
    return [element, ...flatten(element.props.children)];
  }

  it("asks for the stout, and keeps its label", () => {
    const loader = flatten(RouteLoadingShell({ label: "Stories" })).find(
      (element) => element.type === PintLoader,
    ) as ReactElement<Record<string, unknown>> | undefined;
    expect(loader?.props.pour).toBe("stout");
    expect(loader?.props.label).toBe("Stories");
    expect(loader?.props.labelSize).toBe("quiet");
  });
});

type ParsedDeclaration = { selector: string; property: string; value: string; media: string[] };

function declarations(): ParsedDeclaration[] {
  const out: ParsedDeclaration[] = [];
  postcss.parse(readFileSync(CSS_PATH, "utf8")).walkDecls((decl: Declaration) => {
    const media: string[] = [];
    for (let node = decl.parent; node && node.type !== "root"; node = node.parent) {
      if (node.type !== "atrule") continue;
      const atRule = node as AtRule;
      if (atRule.name === "keyframes") return;
      if (atRule.name === "media") media.push(atRule.params.replace(/\s+/g, " ").trim());
    }
    const selector = decl.parent?.type === "rule" ? (decl.parent as Rule).selector : "";
    out.push({ selector, property: decl.prop.toLowerCase(), value: decl.value.trim(), media });
  });
  return out;
}

function keyframeOffsets(name: string): Map<string, string> {
  const steps = new Map<string, string>();
  postcss.parse(readFileSync(CSS_PATH, "utf8")).walkAtRules("keyframes", (rule) => {
    if (rule.params !== name) return;
    rule.walkRules((step) => {
      const transform = step.nodes.find(
        (node): node is Declaration => node.type === "decl" && node.prop === "transform",
      );
      for (const offset of step.selector.split(",")) steps.set(offset.trim(), transform?.value ?? "");
    });
  });
  return steps;
}

describe("the pour's stylesheet", () => {
  it("moves only for readers who have not asked for less motion", () => {
    const animated = declarations().filter(
      (decl) =>
        (decl.property === "animation" || decl.property === "animation-name") && decl.value !== "none",
    );
    expect(animated.length).toBeGreaterThan(0);
    for (const decl of animated) {
      expect(decl.media, decl.selector).toContain("(prefers-reduced-motion: no-preference)");
    }
  });

  it("rests on a full, settled glass: no stream and no bubbles", () => {
    const rest = declarations().filter((decl) => decl.media.length === 0);
    const opacity = (selector: string) =>
      rest.find((decl) => decl.selector === selector && decl.property === "opacity")?.value;
    expect(opacity(".pourStream")).toBe("0");
    expect(opacity(".pourBubble")).toBe("0");
    // Nothing at rest moves the liquid, the head or the settling stout.
    expect(rest.filter((decl) => decl.property === "transform")).toEqual([]);
  });

  it("paints every colour from a design token", () => {
    const paints = declarations().filter(
      (decl) => ["fill", "stroke", "stop-color", "color"].includes(decl.property) && decl.value !== "none",
    );
    expect(paints.length).toBeGreaterThan(0);
    for (const decl of paints) {
      expect(decl.value, `${decl.selector} ${decl.property}`).toMatch(/var\(--/);
      expect(decl.value).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    }
  });

  it("holds still over the map's opening picture, like the classic glass", () => {
    const hold = declarations().find(
      (decl) => decl.selector.includes('[data-map-ground="on"]') && decl.property === "animation",
    );
    expect(hold?.value).toBe("none");
    expect(hold?.selector).toMatch(/:is\(\.mapSkeleton, \.mapLoading\)/);
    expect(hold?.selector).toContain(".pourGlass");
  });

  // The stream's foot sits on the beer: both move on the same keyframes, and
  // the stream is 20 units plus the liquid's 84-unit drop out of 104.
  it.each([
    ["pourLagerRise", "pourLagerStream", "6%", "58%"],
    ["pourStoutRise", "pourStoutStream", "5%", "40%"],
  ])("lands %s's stream on the surface", (rise, stream, start, full) => {
    const liquid = keyframeOffsets(rise);
    const fall = keyframeOffsets(stream);
    expect(liquid.get(start)).toBe("translateY(84px)");
    expect(fall.get(start)).toBe("scaleY(1)");
    expect(liquid.get(full)).toBe("translateY(0)");
    expect(fall.get(full)).toBe(`scaleY(${(20 / 104).toFixed(4)})`);
  });
});
