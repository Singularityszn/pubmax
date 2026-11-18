#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * THE RULE: wait for the event. e2e/AGENTS.md forbids fixed sleeps
 * (`page.waitForTimeout`), per-test and per-suite timeouts
 * (`test.setTimeout`, `testInfo.setTimeout`, a `timeout` key in
 * `test.use`/`test.describe.configure`) and test-runner retries
 * (`retries` that is not literal 0, in a spec or in a Playwright config).
 * Web-first assertions (`expect(...).toPass()`) and auto-waiting locators
 * are the allowed idiom and are not scanned.
 *
 * THE GRANDFATHER LIST is e2e/waits.allowlist.json inside the scanned root.
 * Every row names a file, a kind and an exact count, so a violation that is
 * removed leaves a stale row (a failure that says to shrink the list) and a
 * new violation of a listed kind has no count left to spend (also a
 * failure). The list can only shrink. `configRetries` rows must argue
 * themselves with `reason` and `ends`, the same contract the conditional
 * skip allowlist states.
 *
 * Usage: node scripts/assert-e2e-waits.mjs [e2eDir]
 * The Playwright configs the runner actually loads sit beside the spec
 * tree, so the script reads `playwright*.config.*` in the scanned root's
 * parent directory.
 */

const KINDS = new Set([
  "waitForTimeout",
  "testTimeout",
  "suiteTimeout",
  "suiteRetries",
  "configRetries",
]);

const SOURCE = /\.[cm]?[jt]sx?$/;
const CONFIG = /^playwright.*\.config\.[cm]?[jt]s$/;

function scriptKind(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

async function filesUnder(entry, pattern) {
  const info = await stat(entry);
  if (info.isFile()) return pattern.test(entry) ? [entry] : [];

  const files = [];
  for (const name of await readdir(entry)) {
    const child = path.join(entry, name);
    const childInfo = await stat(child);
    if (childInfo.isDirectory()) files.push(...(await filesUnder(child, pattern)));
    else if (pattern.test(name) && !name.endsWith(".d.ts")) files.push(child);
  }
  return files;
}

/** Dotted callee name, so `test.describe.configure` reads as one string. */
function calleeName(expression) {
  const parts = [];
  let node = expression;
  while (ts.isPropertyAccessExpression(node)) {
    parts.unshift(node.name.text);
    node = node.expression;
  }
  if (ts.isIdentifier(node)) parts.unshift(node.text);
  else return null;
  return parts.join(".");
}

function isLiteralZero(node) {
  return ts.isNumericLiteral(node) && node.text === "0";
}

/**
 * Every violation in one parsed file, as { kind, line } rows. `file` is
 * already relative to the directory the allowlist names.
 */
function violationsIn(sourceFile, file) {
  const found = [];
  const record = (node, kind) => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ file, kind, line: position.line + 1 });
  };

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;

      if (ts.isPropertyAccessExpression(expression)) {
        if (expression.name.text === "waitForTimeout") {
          record(node, "waitForTimeout");
        } else if (
          expression.name.text === "setTimeout" &&
          ts.isIdentifier(expression.expression) &&
          (expression.expression.text === "test" || expression.expression.text === "testInfo")
        ) {
          record(node, "testTimeout");
        }
      }

      const name = calleeName(expression);
      if (name === "test.use" || name === "test.describe.configure") {
        const first = node.arguments[0];
        if (first && ts.isObjectLiteralExpression(first)) {
          for (const property of first.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const key = property.name.getText(sourceFile).replace(/^["']|["']$/g, "");
            if (key === "timeout") record(node, "suiteTimeout");
            else if (key === "retries" && !isLiteralZero(property.initializer)) {
              record(node, "suiteRetries");
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** `retries:` that is not literal 0 anywhere in a Playwright config. */
function configRetriesIn(sourceFile, file) {
  const found = [];
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceFile).replace(/^["']|["']$/g, "") === "retries" &&
      !isLiteralZero(node.initializer)
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({ file, kind: "configRetries", line: position.line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

async function scanFile(file, relative, kind) {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  return kind === "config" ? configRetriesIn(sourceFile, relative) : violationsIn(sourceFile, relative);
}

/**
 * Every timing violation under `root` (the spec tree) plus the Playwright
 * configs beside it. `root` defaults to `e2e`; allowlist paths are relative
 * to the root's parent so a fixture `repo/e2e` scans exactly like the tree.
 * @returns {Promise<{ violations: {file: string, kind: string, line: number}[], scanned: number }>}
 */
export async function scan(root = "e2e") {
  const resolvedRoot = path.resolve(root);
  const baseDir = path.dirname(resolvedRoot);
  const relative = (file) => path.relative(baseDir, file).split(path.sep).join("/");

  let specFiles;
  let configFiles;
  try {
    specFiles = await filesUnder(resolvedRoot, SOURCE);
    configFiles = (await readdir(baseDir)).filter((name) => CONFIG.test(name)).map((name) => path.join(baseDir, name));
  } catch (error) {
    throw new Error(`e2e wait scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (specFiles.length === 0) {
    throw new Error(`e2e wait scan failed: no e2e sources found under ${root}`);
  }

  const violations = [];
  for (const file of specFiles) violations.push(...(await scanFile(file, relative(file), "spec")));
  for (const file of configFiles) violations.push(...(await scanFile(file, relative(file), "config")));

  return { violations, scanned: specFiles.length + configFiles.length };
}

async function readAllowlist(root) {
  let raw;
  try {
    raw = await readFile(path.join(root, "waits.allowlist.json"), "utf8");
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed.allowed) ? parsed.allowed : [];
  const seen = new Set();
  for (const row of rows) {
    if (!row.file || !KINDS.has(row.kind) || !Number.isInteger(row.count) || row.count < 1) {
      console.error(
        `waits allowlist row is incomplete: every row needs file, a known kind and a positive count (${JSON.stringify(row)})`,
      );
      process.exit(1);
    }
    // One row per file and kind: duplicates would sum into the allowance but
    // be checked stale row by row, leaving a reusable count behind.
    const key = `${row.file}|${row.kind}`;
    if (seen.has(key)) {
      console.error(`waits allowlist repeats ${key}: merge the rows into one count`);
      process.exit(1);
    }
    seen.add(key);
    // A runner retry is argued like a conditional skip: the row names the
    // reason it exists and what ends it, so it cannot outlive its excuse.
    if (row.kind === "configRetries" && (!row.reason || !row.ends)) {
      console.error(
        `waits allowlist row ${row.file} (${row.kind}) must state reason and ends`,
      );
      process.exit(1);
    }
  }
  return rows;
}

function main() {
  const root = path.resolve(process.argv[2] ?? "e2e");
  return (async () => {
    const [{ violations, scanned }, allowlist] = await Promise.all([
      scan(root),
      readAllowlist(root),
    ]);

    const allowed = new Map();
    for (const row of allowlist) {
      const key = `${row.file}|${row.kind}`;
      allowed.set(key, (allowed.get(key) ?? 0) + row.count);
    }

    const actual = new Map();
    for (const violation of violations) {
      const key = `${violation.file}|${violation.kind}`;
      actual.set(key, (actual.get(key) ?? 0) + 1);
    }

    // A row is stale the moment the tree holds fewer violations than it
    // argues for: the list can only ever shrink.
    const stale = allowlist.filter((row) => (actual.get(`${row.file}|${row.kind}`) ?? 0) < row.count);
    if (stale.length > 0) {
      for (const row of stale) {
        console.error(
          `waits allowlist row is stale: ${row.file} (${row.kind}) allows ${row.count}, the tree holds ${actual.get(`${row.file}|${row.kind}`) ?? 0}`,
        );
      }
      console.error(
        `e2e wait scan failed: ${stale.length} stale allowlist row(s). Lower or delete the row when the violation goes.`,
      );
      process.exit(1);
    }

    // Every occurrence past its key's allowed count is a new violation.
    const spent = new Map();
    const findings = [];
    for (const violation of violations) {
      const key = `${violation.file}|${violation.kind}`;
      const used = (spent.get(key) ?? 0) + 1;
      spent.set(key, used);
      if (used > (allowed.get(key) ?? 0)) findings.push(violation);
    }

    if (findings.length > 0) {
      for (const finding of findings) {
        console.error(`${finding.file}:${finding.line}: ${finding.kind} is forbidden`);
      }
      console.error(
        `e2e wait scan failed: ${findings.length} finding(s) outside the grandfather list. Wait for the event instead.`,
      );
      process.exit(1);
    }

    console.log(`e2e wait scan passed: ${scanned} file(s), ${violations.length} grandfathered violation(s)`);
  })();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
