// ONE ICON SYSTEM  (docs/DESIGN_SYSTEM.md · "Icons", lib/iconScale.ts)
//
// Every lucide-react icon in app/ and components/ draws at a size on the scale
// and at Lucide's own stroke. Measured on 18 Oct 2026, before this fence: 478
// icons at 23 sizes (10 to 44) and 7 stroke widths. The only icons off the
// scale are the display marks lib/iconScale.ts names, and each keeps exactly
// the size (and stroke) it is named with.
//
// An icon is a JSX element whose tag is a lucide-react import, or, in a file
// that imports lucide-react, a capitalised `*Icon` binding that is not a
// component declared in that file (a `const KindIcon = KIND_ICON[kind]`, a
// destructured `{ icon: Icon }`). A size is a number literal, both branches of
// a conditional, or a const of this file holding one. A size passed through
// from a prop is allowed only for the forwarders named below, and the fence
// then checks every caller's literal instead.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  ICON_DISPLAY_MARKS,
  ICON_DISPLAY_STROKES,
  ICON_SIZE,
  ICON_SIZES,
  ICON_STROKE,
} from "@/lib/iconScale";

const ROOT = process.cwd();

/** Components that hand their `size` prop straight to a lucide icon. */
const SIZE_FORWARDERS: Record<string, string> = {
  "components/social/ReviewStars.tsx": "ReviewStars",
};

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const FILES = [...tsxFiles("app"), ...tsxFiles("components")].map((file) => relative(ROOT, join(ROOT, file)));

type Finding = { at: string; problem: string };

interface Scan {
  icons: number;
  findings: Finding[];
  forwarderCalls: Finding[];
}

function literalSizes(expr: ts.Expression, consts: Map<string, ts.Expression>): number[] | null {
  if (ts.isNumericLiteral(expr)) return [Number(expr.text)];
  if (ts.isParenthesizedExpression(expr)) return literalSizes(expr.expression, consts);
  if (ts.isConditionalExpression(expr)) {
    const a = literalSizes(expr.whenTrue, consts);
    const b = literalSizes(expr.whenFalse, consts);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(expr) && consts.has(expr.text)) return literalSizes(consts.get(expr.text)!, consts);
  if (ts.isPropertyAccessExpression(expr) && expr.expression.getText() === "ICON_SIZE") {
    const value = (ICON_SIZE as Record<string, number>)[expr.name.text];
    return value === undefined ? null : [value];
  }
  return null;
}

function scan(): Scan {
  let icons = 0;
  const findings: Finding[] = [];
  const forwarderCalls: Finding[] = [];
  const forwarderNames = new Set(Object.values(SIZE_FORWARDERS));

  for (const file of FILES) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lucide = new Set<string>();
    for (const statement of sf.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "lucide-react" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        for (const element of statement.importClause.namedBindings.elements) {
          if (!element.isTypeOnly) lucide.add(element.name.text);
        }
      }
    }

    // Components declared in this file, and consts holding a number.
    const components = new Set<string>();
    const consts = new Map<string, ts.Expression>();
    const collect = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) components.add(node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = node.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) components.add(node.name.text);
        else if (ts.isNumericLiteral(init)) consts.set(node.name.text, init);
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);

    const isIcon = (tag: string) =>
      lucide.has(tag) || (lucide.size > 0 && /^[A-Z]\w*Icon$|^Icon$/.test(tag) && !components.has(tag));

    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(sf);
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const at = `${file}:${line} <${tag}>`;
        const attr = (name: string) =>
          node.attributes.properties.find(
            (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name,
          );

        if (forwarderNames.has(tag)) {
          const size = attr("size");
          if (size?.initializer && ts.isJsxExpression(size.initializer) && size.initializer.expression) {
            const values = literalSizes(size.initializer.expression, consts);
            if (!values) forwarderCalls.push({ at, problem: "size is not a literal on the scale" });
            else for (const v of values) if (!ICON_SIZES.includes(v)) forwarderCalls.push({ at, problem: `size ${v}` });
          }
        }

        if (isIcon(tag)) {
          icons += 1;
          const marks = ICON_DISPLAY_MARKS[file] ?? [];
          const strokes = ICON_DISPLAY_STROKES[file] ?? [];
          const size = attr("size");
          if (size) {
            const expr =
              size.initializer && ts.isJsxExpression(size.initializer) ? size.initializer.expression : undefined;
            const forwarded =
              expr && ts.isIdentifier(expr) && expr.text === "size" && SIZE_FORWARDERS[file] !== undefined;
            const values = expr ? literalSizes(expr, consts) : null;
            if (forwarded) {
              // checked at every caller below
            } else if (!values) {
              findings.push({ at, problem: `size ${expr?.getText(sf) ?? "?"} is not a literal on the scale` });
            } else {
              for (const v of values) {
                if (!ICON_SIZES.includes(v) && !marks.includes(`${tag}:${v}`)) {
                  findings.push({ at, problem: `size ${v} is off the scale ${ICON_SIZES.join("/")}` });
                }
              }
            }
          }
          const stroke = attr("strokeWidth");
          if (stroke) {
            const text =
              stroke.initializer && ts.isJsxExpression(stroke.initializer) && stroke.initializer.expression
                ? stroke.initializer.expression.getText(sf)
                : "?";
            if (!strokes.includes(`${tag}:${text}`)) {
              findings.push({ at, problem: `strokeWidth ${text}: icons keep Lucide's own ${ICON_STROKE}` });
            }
          }
          if (attr("absoluteStrokeWidth")) findings.push({ at, problem: "absoluteStrokeWidth" });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { icons, findings, forwarderCalls };
}

const result = scan();
const fmt = (list: Finding[]) => list.map((f) => `${f.at}: ${f.problem}`).join("\n");

describe("one icon system", () => {
  it("finds the icons it fences", () => {
    // A parser that stopped seeing icons would pass every check below.
    expect(result.icons).toBeGreaterThan(400);
  });

  it("names four sizes and Lucide's own stroke", () => {
    expect(ICON_SIZES).toEqual([14, 16, 20, 24]);
    expect(ICON_STROKE).toBe(2);
  });

  it("draws every icon on the scale, at Lucide's own stroke", () => {
    expect(fmt(result.findings)).toBe("");
  });

  it("hands a forwarding component only sizes on the scale", () => {
    expect(fmt(result.forwarderCalls)).toBe("");
    const stars = readFileSync(join(ROOT, "components/social/ReviewStars.tsx"), "utf8");
    const fallback = /size = (\d+),/.exec(stars);
    expect(fallback, "ReviewStars declares a default size").not.toBeNull();
    expect(ICON_SIZES).toContain(Number(fallback![1]));
  });

  it("names only display marks that still exist", () => {
    for (const [file, marks] of Object.entries(ICON_DISPLAY_MARKS)) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const mark of marks) {
        const [tag, size] = mark.split(":");
        expect(source, `${file} still draws <${tag} size={${size}}>`).toMatch(
          new RegExp(`<${tag}\\b[^>]*size=\\{${size}\\}`),
        );
      }
    }
  });
});
