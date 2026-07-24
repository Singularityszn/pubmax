#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "e2e");

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

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function isIntentionalProjectGate(file, expression) {
  const compact = expression.replace(/\s+/g, " ").trim();
  if (/^!process\.env\.[A-Z0-9_]+$/.test(compact)) return true;
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
  const pattern = /\btest\.(skip|fixme)\s*\(\s*([^,\n]+)(?:,|\))/g;
  for (const match of source.matchAll(pattern)) {
    const expression = match[2].trim();
    if (!isIntentionalProjectGate(file, expression)) {
      findings.push({
        file: path.relative(process.cwd(), file),
        line: lineNumber(source, match.index ?? 0),
        kind: match[1],
        expression,
      });
    }
  }

  const staticPattern = /\b(?:test|describe)\.(skip|fixme)\s*\(\s*["'`]/g;
  for (const match of source.matchAll(staticPattern)) {
    findings.push({
      file: path.relative(process.cwd(), file),
      line: lineNumber(source, match.index ?? 0),
      kind: match[1],
      expression: "static skipped declaration",
    });
  }
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
