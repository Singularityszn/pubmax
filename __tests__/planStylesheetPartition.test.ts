import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import original from "./fixtures/planStylesheet7ac2402b.json";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

// This frozen declaration inventory belongs to the reviewed 7ac2402b sheet.
// Each selector keeps its ordered declarations and enclosing conditions.
function inventory(css: string) {
  const result: Record<string, Array<Array<[string, string, boolean]>>> = {};
  postcss.parse(css).walkRules((rule) => {
    const conditions: Array<[string, string]> = [];
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type === "atrule") conditions.unshift([parent.name, parent.params]);
    }
    const declarations = rule.nodes.flatMap((node): Array<[string, string, boolean]> =>
      node.type === "decl" ? [[node.prop, node.value, Boolean(node.important)]] : []);
    for (const selector of rule.selectors) {
      const key = JSON.stringify([conditions, selector]);
      (result[key] ??= []).push(declarations);
    }
  });
  return result;
}

function originalInventory() {
  const result: ReturnType<typeof inventory> = {};
  for (const rule of original.rules) {
    for (const selector of rule.selectors) {
      const key = JSON.stringify([rule.conditions, selector]);
      (result[key] ??= []).push(rule.declarations as Array<[string, string, boolean]>);
    }
  }
  return result;
}

function orderedInventory(css: string) {
  const declarations = inventory(css);
  // Use actual rule traversal, including each repeated occurrence, for order.
  const occurrences: Record<string, number> = {};
  const ordered: Array<[string, Array<[string, string, boolean]>]> = [];
  postcss.parse(css).walkRules((rule) => {
    const conditions: Array<[string, string]> = [];
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type === "atrule") conditions.unshift([parent.name, parent.params]);
    }
    for (const selector of rule.selectors) {
      const key = JSON.stringify([conditions, selector]);
      const index = occurrences[key] ?? 0;
      occurrences[key] = index + 1;
      ordered.push([key, declarations[key][index]]);
    }
  });
  return ordered;
}

function labelSize(css: string, kind: "group" | "budget") {
  const dom = new JSDOM(`<form class="planComposer"><div class="planIntake__${kind}"><label>People</label></div></form>`);
  try {
    dom.window.document.documentElement.style.fontSize = "16px";
    const label = dom.window.document.querySelector("label")!;
    const matching = postcss.root();
    postcss.parse(css).walkRules((rule) => {
      if (rule.parent?.type === "root" && rule.selectors.some((selector) => label.matches(selector))) {
        matching.append(rule.clone());
      }
    });
    const style = dom.window.document.createElement("style");
    style.textContent = matching.toString();
    dom.window.document.head.append(style);
    return dom.window.getComputedStyle(label).fontSize;
  } finally {
    dom.window.close();
  }
}

describe("Plan stylesheet declaration ownership", () => {
  it("keeps the entry sheet on the reviewed shell and entry rules", () => {
    const entry = postcss.parse(read("app/plan/plan.css"));
    const selectors: string[] = [];
    entry.walkRules((rule) => { selectors.push(...rule.selectors); });
    expect(selectors).not.toContain(".planIntake");
    expect(selectors).not.toContain(".planResult");
    expect(selectors).not.toContain(".planCrew");
    expect(selectors).not.toContain(".planComposer__stops");
    expect(selectors).not.toContain(".planComposer__lock");
    expect(selectors).toContain(".planComposer input");
    expect(selectors).toContain(".planComposer label");
    expect(selectors).toContain(".planComposer legend");
    expect(selectors).toContain(".planComposer__error");
    expect(selectors).toContain(".planPage *::after");
    const rules: unknown[] = [];
    entry.walkRules((rule) => { rules.push(rule); });
    // The 59 reviewed entry nodes plus one canonical label cascade dependency.
    expect(rules).toHaveLength(60);
  });

  it("preserves every original declaration, condition and repeated selector winner", () => {
    const entry = read("app/plan/plan.css");
    const full = read("app/plan/planFull.css");
    const imports = postcss.parse(full).nodes.flatMap((node) => node.type === "atrule" && node.name === "import" ? [node.params] : []);
    expect(imports).toEqual(['"./plan.css"']);
    expect(postcss.parse(full).nodes[0]).toMatchObject({ type: "atrule", name: "import" });
    expect(inventory(entry + "\n" + full)).toEqual(originalInventory());
    const entryKeys = new Set(Object.keys(inventory(entry)));
    const reviewedOrder = original.rules.flatMap((rule) => rule.selectors.map((selector) => [
      JSON.stringify([rule.conditions, selector]), rule.declarations,
    ]));
    expect(orderedInventory(entry)).toEqual(reviewedOrder.filter(([key]) => entryKeys.has(key as string)));
    expect(orderedInventory(full)).toEqual(reviewedOrder.filter(([key]) => !entryKeys.has(key as string)));
  });

  it.each(["group", "budget"] as const)("preserves the %s label cascade and detects a deferred dependency", (kind) => {
    const entry = read("app/plan/plan.css");
    const full = read("app/plan/planFull.css");
    expect(labelSize(entry + "\n" + full, kind)).toBe("13.12px");
    const incorrectEntry = postcss.parse(entry);
    const incorrectFull = postcss.parse(full);
    incorrectEntry.walkRules((rule) => {
      if (rule.selectors.includes(".planIntake__group label")) {
        incorrectFull.append(rule.clone());
        rule.remove();
      }
    });
    expect(labelSize(incorrectEntry.toString() + "\n" + incorrectFull.toString(), kind)).toBe("11.84px");
  });
});
