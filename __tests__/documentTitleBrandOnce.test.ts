import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// A document title is the page's own words, and the root layout's template
// (`%s | PUBMAXX`) adds the name, so a page never types the suffix itself
// (docs/rules/lib-shared-seams-stores-http-freshness-brand.md). The fence in
// __tests__/brandNaming.test.ts resolves five pages through Next's resolver;
// this one is the CLASS: it reads every page and layout under app/ and refuses
// a document `title` that already carries the brand, because 2,629 of the
// 2,687 sitemap URLs once rendered `… · PUBMAXX | PUBMAXX` (SEO audit #2126)
// while the five listed pages passed.
//
// Share-card titles are exempt: Next does not run `openGraph.title` or
// `twitter.title` through the layout's template, so those keep their own
// `appPageTitle()` suffix. `appleWebApp.title` is the home-screen name, not a
// document title, so it names the brand alone.

const APP_DIR = path.join(process.cwd(), "app");
const BRAND = "PUBMAXX";
const NOT_A_DOCUMENT_TITLE = new Set(["openGraph", "twitter", "appleWebApp"]);

// A page whose subject IS the brand may name it in its own words.
const BRAND_IS_THE_SUBJECT = new Map<string, string>([
  ["app/about/page.tsx", "About PUBMAXX is a page about the brand itself."],
]);

// Titles another open pull request already rewrites. Each row names its owner,
// and the list may only shrink.
const PENDING_IN_OPEN_PR = new Map<string, string>([]);

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return /^(page|layout)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every `const NAME = <expr>` in the file, so an identifier title resolves. */
function constInitializers(source: ts.SourceFile): Map<string, ts.Expression> {
  const found = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      found.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function carriesBrand(
  expr: ts.Expression,
  consts: Map<string, ts.Expression>,
  seen = new Set<string>(),
): boolean {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text.includes(BRAND);
  }
  if (ts.isTemplateExpression(expr)) {
    if (expr.head.text.includes(BRAND)) return true;
    return expr.templateSpans.some(
      (span) => span.literal.text.includes(BRAND) || carriesBrand(span.expression, consts, seen),
    );
  }
  if (ts.isIdentifier(expr)) {
    if (expr.text === "BRAND_NAME") return true;
    const init = consts.get(expr.text);
    if (!init || seen.has(expr.text)) return false;
    seen.add(expr.text);
    return carriesBrand(init, consts, seen);
  }
  if (ts.isCallExpression(expr)) {
    return ts.isIdentifier(expr.expression) && expr.expression.text === "appPageTitle";
  }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return carriesBrand(expr.expression, consts, seen);
  }
  if (ts.isConditionalExpression(expr)) {
    return carriesBrand(expr.whenTrue, consts, seen) || carriesBrand(expr.whenFalse, consts, seen);
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return carriesBrand(expr.left, consts, seen) || carriesBrand(expr.right, consts, seen);
  }
  return false;
}

/** True inside `export const metadata = …` or a `generateMetadata` body. */
function inMetadata(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name) && at.name.text === "metadata") {
      return true;
    }
    if (ts.isFunctionDeclaration(at) && at.name?.text === "generateMetadata") return true;
  }
  return false;
}

/** True under an `openGraph`, `twitter` or `appleWebApp` key. */
function inShareCard(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (
      ts.isPropertyAssignment(at) &&
      ts.isIdentifier(at.name) &&
      NOT_A_DOCUMENT_TITLE.has(at.name.text)
    ) {
      return true;
    }
  }
  return false;
}

/** Document titles in one file that already carry the brand, as `file:line`. */
function brandedDocumentTitles(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const consts = constInitializers(source);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "title" &&
      !ts.isObjectLiteralExpression(node.initializer) &&
      inMetadata(node) &&
      !inShareCard(node)
    ) {
      if (carriesBrand(node.initializer, consts)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        hits.push(`${file}:${line + 1}`);
      }
    }
    if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === "title" &&
      inMetadata(node) &&
      !inShareCard(node)
    ) {
      const init = consts.get("title");
      if (init && carriesBrand(init, consts)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        hits.push(`${file}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("a page's document title never types the brand the template adds", () => {
  const files = pageFiles(APP_DIR).map((full) => path.relative(process.cwd(), full));

  it("reads the whole app tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds no branded document title outside the argued exceptions", () => {
    const offenders = files
      .filter((file) => !BRAND_IS_THE_SUBJECT.has(file) && !PENDING_IN_OPEN_PR.has(file))
      .flatMap((file) => brandedDocumentTitles(file, readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps every exception live, so the lists can only shrink", () => {
    for (const file of [...BRAND_IS_THE_SUBJECT.keys(), ...PENDING_IN_OPEN_PR.keys()]) {
      const hits = brandedDocumentTitles(file, readFileSync(file, "utf8"));
      expect(hits, `${file} no longer brands its title; drop its exception`).not.toEqual([]);
    }
  });

  it("catches each shape a branded title has taken", () => {
    const shapes = [
      'export const metadata = { title: "Tonight in London · PUBMAXX" };',
      "const t = `The Ledger: ${name}. PUBMAXX`; export async function generateMetadata() { return { title: t }; }",
      "export async function generateMetadata() { const title = `${n} | PUBMAXX`; return { title }; }",
      "export const metadata = { title: appPageTitle(PAGE_TITLE) };",
      "export const metadata = { title: `${PAGE} · ${BRAND_NAME}` };",
    ];
    for (const shape of shapes) {
      expect(brandedDocumentTitles("fixture.tsx", shape), shape).toHaveLength(1);
    }
  });

  it("leaves share-card titles and unbranded document titles alone", () => {
    const clean = [
      'export const metadata = { title: "Tonight in London", openGraph: { title: "Tonight in London · PUBMAXX" } };',
      "export const metadata = { title: PAGE, twitter: { title: appPageTitle(PAGE) } };",
      'export const metadata = { title: { default: "PUBMAXX: a map", template: "%s | PUBMAXX" } };',
    ];
    for (const shape of clean) {
      expect(brandedDocumentTitles("fixture.tsx", shape), shape).toEqual([]);
    }
  });
});
