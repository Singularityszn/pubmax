/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import postcss, { type Rule } from "postcss";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { Chip } from "@/components/ui/chip";
import { NumberChip } from "@/components/ui/numberChip";
import PlanStopCountPicker from "@/components/plan/PlanStopCountPicker";
import PubsFilters from "@/components/pubs/PubsFilters";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pubs", useRouter: () => ({ push }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A NUMBER SQUARE IS ONE FAMILY. The 6 September 2026 design review measured
// the planner's pub-stop count at 10px corners and the /pubs fare-zone picker
// at --radius-sm on 44px squares: two look-alike controls asking the same
// question in two shapes. Both now use the shared chipBase renderer, painted from
// the same --control-* row every text button reads.

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const chipCss = read("components/ui/chip.css");

function loadChipRenderer(source: string) {
  const stylesheets: string[] = [];
  const module = { exports: {} as { renderChip: (props: { className: string; children: string }, ref: null) => ReturnType<typeof createElement> } };
  const require = createRequire(import.meta.url);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(output, {
    module, exports: module.exports,
    require: (specifier: string) => {
      if (specifier.endsWith(".css")) {
        stylesheets.push(read(join("components/ui", specifier)));
        return {};
      }
      return require(specifier);
    },
  });
  return { ...module.exports, stylesheets };
}

function unlayeredRule(css: string, selector: string): Rule {
  const rules = postcss.parse(css).nodes.filter((node): node is Rule => node.type === "rule" && node.selector === selector);
  expect(rules).toHaveLength(1);
  return rules[0]!;
}

function declarations(rule: Rule) {
  return new Map(rule.nodes.flatMap((node) => node.type === "decl" ? [[node.prop, node.value] as const] : []));
}

function expectNumberButtons(host: HTMLElement, labels: string[]) {
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons.map((button) => button.textContent)).toEqual(labels);
  for (const button of buttons) {
    expect([...button.classList]).toEqual(["uiChip", "uiChip--number"]);
    expect(button.type).toBe("button");
  }
  return buttons;
}

describe("the Chip primitive", () => {
  it("is painted OUTSIDE every cascade layer, where the unlayered reset cannot beat it", () => {
    // Same reason as button.css: `button { font: inherit }` is unlayered in
    // app/globals.css and outranks every layered utility, which is why the
    // Tailwind `text-sm font-bold` this primitive used to carry rendered as the
    // inherited 16px at weight 400.
    const loaded = loadChipRenderer(read("components/ui/chipBase.tsx"));
    expect(loaded.stylesheets).toEqual([chipCss]);
    expect(renderToStaticMarkup(loaded.renderChip({ className: "uiChip", children: "Solo" }, null))).toBe(
      '<button type="button" class="uiChip">Solo</button>',
    );
    expect(declarations(unlayeredRule(chipCss, ".uiChip")).get("display")).toBe("inline-flex");
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(Chip, null, "Solo"));
    expect([...host.querySelector("button")!.classList]).toEqual(["uiChip"]);
  });

  it("reads the one row of control tokens rather than restating a figure", () => {
    const rule = unlayeredRule(chipCss, ".uiChip");
    const base = declarations(rule);
    expect(base.get("min-height")).toBe("var(--control-height, 44px)");
    expect(base.get("font-size")).toBe("var(--control-font-size, 0.86rem)");
    expect(base.get("font-weight")).toBe("var(--control-font-weight, 700)");
    expect(base.get("background")).toBe("var(--control-secondary-surface, var(--color-surface-raised))");
    const properties = rule.nodes.flatMap((node) => node.type === "decl" ? [node.prop] : []);
    expect(properties.indexOf("font")).toBeGreaterThanOrEqual(0);
    expect(base.get("font")).toBe("inherit");
    expect(properties.indexOf("font")).toBeLessThan(properties.indexOf("font-size"));
    const number = declarations(unlayeredRule(chipCss, ".uiChip--number"));
    expect(number.get("min-width")).toBe("var(--control-height, 44px)");
    expect(number.get("border-radius")).toBe("var(--control-radius, 14px)");
  });

  it("composes classes from that sheet and nothing from a utility layer", () => {
    expect(renderToStaticMarkup(createElement(Chip, null, "Solo"))).toBe(
      '<button type="button" class="uiChip">Solo</button>',
    );
    expect(
      renderToStaticMarkup(createElement(Chip, { variant: "number" }, "3")),
    ).toBe('<button type="button" class="uiChip uiChip--number">3</button>');
  });

  it("keeps arbitrary utility-conflict merging in the generic Chip", () => {
    expect(renderToStaticMarkup(createElement(Chip, {
      variant: "number", className: "p-2 p-4", type: "submit", "aria-pressed": true,
    }, "3"))).toBe(
      '<button type="submit" class="uiChip uiChip--number p-4" aria-pressed="true">3</button>',
    );
  });

  it("renders the closed number entry identically to the generic number variant", () => {
    for (const type of [undefined, "button", "submit", "reset"] as const) {
      const props = { type, "aria-pressed": true as const, "aria-disabled": true as const, title: "Pub stops" };
      expect(renderToStaticMarkup(createElement(NumberChip, props, "3"))).toBe(
        renderToStaticMarkup(createElement(Chip, { ...props, variant: "number" }, "3")),
      );
    }
  });

  it("carries the chosen state on aria-pressed, so the state and the label agree", () => {
    const chosen = declarations(unlayeredRule(chipCss, '.uiChip[aria-pressed="true"]'));
    expect(chosen.get("background")).toBe("var(--control-tint-surface, var(--color-surface-raised))");
  });
});

describe("the two number-square surfaces share number-chip behavior", () => {
  it("rejects comment-only CSS, layered paint and bespoke number controls", () => {
    const commentedImport = loadChipRenderer('/* import "./chip.css"; */ export function renderChip() { return null; }');
    expect(() => expect(commentedImport.stylesheets).toEqual([chipCss])).toThrow();
    expect(() => unlayeredRule("/* .uiChip { display: inline-flex } */", ".uiChip")).toThrow();
    expect(() => unlayeredRule("@layer utilities { .uiChip { display: inline-flex } }", ".uiChip")).toThrow();
    const host = document.createElement("div");
    host.innerHTML = '<!-- import NumberChip from "@/components/ui/numberChip" --><button class="text-sm font-bold">3</button>';
    expect(() => expectNumberButtons(host, ["3"])).toThrow();
  });

  it("renders every pub-stop choice with number-chip paint, state and actions", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    try {
      await act(async () => root.render(createElement(PlanStopCountPicker, { value: 3, onChange })));
      const buttons = expectNumberButtons(host, ["1", "2", "3", "4", "5", "6"]);
      expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false", "false", "false"]);
      for (const [index, button] of buttons.entries()) {
        await act(async () => button.click());
        expect(onChange).toHaveBeenLastCalledWith(index + 1);
      }
      expect(onChange).toHaveBeenCalledTimes(6);
      await act(async () => root.render(createElement(PlanStopCountPicker, { value: 3, ready: false, onChange })));
      for (const button of buttons) {
        expect(button.getAttribute("aria-disabled")).toBe("true");
        await act(async () => button.click());
      }
      expect(onChange).toHaveBeenCalledTimes(6);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("renders fare-zone choices with the same paint and preserves the chain when navigating", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    push.mockClear();
    try {
      await act(async () => root.render(createElement(PubsFilters, {
        counts: { all: 3, "nicholsonspubs.co.uk": 0, "youngs.co.uk": 3, "greene-king.co.uk": 0, other: 0 },
        filter: "youngs.co.uk", zone: 2, zonesPresent: [1, 2, 3], showCounts: false,
      })));
      const group = host.querySelector<HTMLElement>('[aria-label="Filter by fare zone"]')!;
      const buttons = expectNumberButtons(group, ["All zones", "1", "2", "3"]);
      expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
      for (const [index, button] of buttons.entries()) {
        await act(async () => button.click());
        expect(push).toHaveBeenLastCalledWith(index === 0 ? "/pubs?source=youngs.co.uk" : `/pubs?source=youngs.co.uk&zone=${index}`);
      }
      expect(push).toHaveBeenCalledTimes(4);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("leaves number-square paint to the chip sheet and keeps the planner layout", () => {
    const sheet = postcss.parse(read("app/plan/plan.css"));
    sheet.walkRules((rule) => expect(rule.selectors).not.toContain(".planStopCount__choices button"));
    expect(declarations(unlayeredRule(sheet.toString(), ".planStopCount__choices")).get("display")).toBe("flex");
  });
});
