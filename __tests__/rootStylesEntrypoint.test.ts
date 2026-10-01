import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const layout = ts.createSourceFile(
  "app/layout.tsx", readFileSync(join(root, "app/layout.tsx"), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);

// Root styles share one compiler entry; theme overrides follow base rules.
// This source contract does not claim emitted CSS count or browser speed.
describe("root stylesheet entry", () => {
  it("loads both global styles through one root import in their original order", () => {
    const imports = layout.statements.filter(ts.isImportDeclaration)
      .map((statement) => ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text : "")
      .filter((specifier) => specifier.endsWith(".css"));
    expect(imports).toEqual(["./rootStyles.css"]);
    const entry = join(root, "app/rootStyles.css");
    expect(existsSync(entry), "Single root stylesheet entry must exist").toBe(true);
    const styles = readFileSync(entry, "utf8");
    expect([...styles.matchAll(/@import\s+["']([^"']+)["']\s*;/g)].map((match) => match[1]))
      .toEqual(["./globals.css", "./theme.css"]);
  });
});
