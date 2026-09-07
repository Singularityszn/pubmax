#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(process.argv[2] ?? "e2e");

/**
 * THE ARGUED EXCEPTIONS, and nothing else, may skip.
 *
 * A skipped browser test is a lane nobody proves, so every skip is refused
 * unless e2e/conditional-skips.allowlist.json names its spec AND the exact
 * condition, with the reason and what ends it. A row that matches no live skip
 * is itself a failure, so the list can only ever shrink.
 */
// PUBMAX_E2E_SKIP_ALLOWLIST points the scan at a fixture list; the tree's own
// list is the default and the only one a run of `npm run gate:e2e-skips` reads.
const ALLOWLIST_PATH = path.resolve(
  process.env.PUBMAX_E2E_SKIP_ALLOWLIST ?? "e2e/conditional-skips.allowlist.json",
);

async function readAllowlist() {
  let raw;
  try {
    raw = await readFile(ALLOWLIST_PATH, "utf8");
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed.allowed) ? parsed.allowed : [];
  for (const row of rows) {
    if (!row.file || !row.condition || !row.reason || !row.ends) {
      console.error(
        `conditional skip allowlist is incomplete: every row needs file, condition, reason and ends (${JSON.stringify(row)})`,
      );
      process.exit(1);
    }
    // A row argues NAMED TESTS. Without them the run gate
    // (scripts/assert-playwright-gate.mjs) reads `file` alone and a new
    // unargued test.skip in an allowlisted spec passes in silence.
    if (!Array.isArray(row.tests) || row.tests.length === 0) {
      console.error(
        `conditional skip allowlist row ${row.file} must name the tests it argues in a "tests" array`,
      );
      process.exit(1);
    }
  }
  return rows;
}

const allowlist = await readAllowlist();
const allowlistHits = new Set();

function compact(expression) {
  return expression.replace(/\s+/g, " ").trim();
}

function isAllowed(file, expression) {
  const relative = path.relative(process.cwd(), file);
  const row = allowlist.find(
    (entry) => entry.file === relative && entry.condition === compact(expression),
  );
  if (!row) return false;
  allowlistHits.add(`${row.file}::${row.condition}`);
  return true;
}

async function filesUnder(entry) {
  const info = await stat(entry);
  if (info.isFile()) return [entry];

  const files = [];
  for (const name of await readdir(entry)) {
    const child = path.join(entry, name);
    const childInfo = await stat(child);
    if (childInfo.isDirectory()) files.push(...(await filesUnder(child)));
    else if (/\.spec\.[cm]?[jt]sx?$/.test(name)) files.push(child);
  }
  return files;
}

function scriptKind(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function skipCallKind(expression) {
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const method = expression.name.text;
  if (method !== "skip" && method !== "fixme") return null;

  const owner = expression.expression;
  if (ts.isIdentifier(owner) && owner.text === "test") return method;
  if (
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "describe" &&
    ts.isIdentifier(owner.expression) &&
    owner.expression.text === "test"
  ) {
    return `describe.${method}`;
  }
  return null;
}

/**
 * Module-scope `const NAME = process.env.X ...` declarations, so a skip written
 * as `!SHOOTING` is judged as the environment gate it is rather than as a
 * data-dependent condition. The initialiser must read process.env and NOTHING
 * else: a const derived from a page read is exactly what this scan refuses.
 */
function environmentConstants(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const text = declaration.initializer.getText(sourceFile);
      if (/process\.env\.[A-Z0-9_]+/.test(text) && !/\b(await|page|request)\b/.test(text)) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function isIntentionalProjectGate(file, expression, envConstants = new Set()) {
  const compact = expression.replace(/\s+/g, " ").trim();
  if (/^\(*!process\.env\.[A-Z0-9_]+\)*$/.test(compact)) return true;
  const negatedConstant = /^\(*!([A-Za-z_$][\w$]*)\)*$/.exec(compact);
  if (negatedConstant && envConstants.has(negatedConstant[1])) return true;
  if (
    path.basename(file) === "screenshots.spec.ts" &&
    /^(?:!?isDesktop|isDesktop \|\| viewportName !== ["']390["'])$/.test(compact)
  ) {
    return true;
  }
  return false;
}

let files;
try {
  files = await filesUnder(root);
} catch (error) {
  console.error(
    `conditional skip scan failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}

if (files.length === 0) {
  console.error(`conditional skip scan failed: no E2E specs found under ${root}`);
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );

  const envConstants = environmentConstants(sourceFile);

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const kind = skipCallKind(node.expression);
      if (kind) {
        const argument = node.arguments[0];
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const stated = argument?.getText(sourceFile) ?? "missing condition";
        let expression = stated;
        const staticDeclaration =
          !argument ||
          ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument) ||
          kind.startsWith("describe.");
        if (staticDeclaration) expression = "static skipped declaration";
        // The allowlist names the condition a reader can see in the spec, so a
        // static skip is matched on its own text rather than on that label.
        if (staticDeclaration && isAllowed(file, stated)) {
          ts.forEachChild(node, visit);
          return;
        }

        const excused =
          isAllowed(file, expression) ||
          (!staticDeclaration && isIntentionalProjectGate(file, expression, envConstants));
        if (!excused) {
          findings.push({
            file: path.relative(process.cwd(), file),
            line: position.line + 1,
            kind,
            expression: expression.replace(/\s+/g, " ").trim(),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

// Only rows about the tree being scanned can be judged: the unit fixtures run
// this script over a temporary directory, where the real specs do not exist.
const scannedRoot = path.relative(process.cwd(), root);
const staleRows = allowlist.filter(
  (row) =>
    row.file.startsWith(`${scannedRoot}/`) &&
    !allowlistHits.has(`${row.file}::${row.condition}`),
);

// A named test that the spec no longer holds is the same stale exception as a
// condition that no longer matches: the run gate would argue a title nothing
// can produce, and the row would outlive the skip it was written for.
const missingTitles = [];
for (const row of allowlist) {
  if (!row.file.startsWith(`${scannedRoot}/`)) continue;
  let source;
  try {
    source = await readFile(path.resolve(process.cwd(), row.file), "utf8");
  } catch {
    continue;
  }
  for (const title of row.tests) {
    if (!source.includes(title)) missingTitles.push({ file: row.file, title });
  }
}
if (missingTitles.length > 0) {
  for (const missing of missingTitles) {
    console.error(
      `conditional skip allowlist names a test that spec no longer holds: ${missing.file} ("${missing.title}")`,
    );
  }
  console.error(
    `conditional skip scan failed: ${missingTitles.length} allowlist title(s) match no test. Update the row when a test is renamed.`,
  );
  process.exit(1);
}
if (staleRows.length > 0) {
  for (const row of staleRows) {
    console.error(
      `conditional skip allowlist row matches no live skip: ${row.file} (${row.condition})`,
    );
  }
  console.error(
    `conditional skip scan failed: ${staleRows.length} stale allowlist row(s). Delete the row when the skip goes.`,
  );
  process.exit(1);
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}: ${finding.kind} depends on ${finding.expression}`,
    );
  }
  console.error(`conditional skip scan failed: ${findings.length} finding(s)`);
  process.exit(1);
}

console.log(`conditional skip scan passed: ${files.length} spec file(s)`);
