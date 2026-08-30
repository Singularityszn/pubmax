// Every field on a plan surface names its own type.
//
// The 30 August live audit typed "soho pints" into the /plan composer and found
// the input carrying no `type` at all. A bare `<input>` behaves as text, so
// nothing looked broken - which is the reason it spread to eight fields across
// the plan surfaces before anybody wrote it down. What it costs is not
// behaviour: assistive technology and mobile keyboards read the attribute to
// decide what kind of field this is, and an omitted one is a default they have
// to assume rather than a fact the markup states.
//
// The fence is the source, in the idiom __tests__/profilePhotoPicker.test.ts
// already uses for the photo pickers: an attribute defect nothing renders
// differently is caught by reading the markup, not by driving it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Every surface that composes a plan, at either width. */
const PLAN_SURFACE_DIRS = ["components/plan", "app/plan"] as const;

function tsxFiles(dir: string): string[] {
  const root = join(process.cwd(), dir);
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".tsx")) out.push(path);
    }
  };
  walk(root);
  return out;
}

type PlanInput = { file: string; hasType: boolean };

function planInputs(): PlanInput[] {
  const found: PlanInput[] = [];
  for (const dir of PLAN_SURFACE_DIRS) {
    for (const path of tsxFiles(dir)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node: ts.Node): void => {
        if (
          (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
          node.tagName.getText(source) === "input"
        ) {
          const hasType = node.attributes.properties.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "type",
          );
          found.push({ file: path.replace(`${process.cwd()}/`, ""), hasType });
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source, visit);
    }
  }
  return found;
}

describe("plan surfaces state what kind of field each input is", () => {
  it("finds inputs to check", () => {
    // A sweep that matched nothing would pass for ever while saying nothing.
    expect(planInputs().length).toBeGreaterThan(5);
  });

  it("leaves no input without a type", () => {
    const untyped = planInputs()
      .filter((input) => !input.hasType)
      .map((input) => input.file);
    expect(untyped).toEqual([]);
  });
});
