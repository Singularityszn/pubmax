import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// A MECHANICAL EDIT LEAVES A TRACK, AND THE TRACK IS WHAT THIS FILE FORBIDS.
//
// Lifting a name out of an export list without reading the line back leaves
// `export { a, b,  };` - a list with an empty last slot. Lifting a statement
// out without reading the line back leaves a bare `;`. Neither is a type
// error, neither is a knip finding, and both say plainly that nobody read the
// file afterwards. Every file in this tree has to read as if a person wrote
// it, so the tree is scanned for both marks.
//
// `no-extra-semi` in eslint.config.mjs owns the bare `;` for the parsers
// eslint runs; this file owns the export-list slot, which has no rule, and
// keeps the semicolon check over the text as well so a file eslint skips is
// still covered.
const ROOT = resolve(process.cwd());
const SCANNED_DIRS = ["app", "components", "lib", "scripts", "__tests__", "e2e"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];
const SKIPPED_DIRS = new Set(["node_modules", "__snapshots__"]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(full);
  }
  return found;
}

// This file spells both marks out to say what they are, so it scans every
// source file but itself.
const SELF = resolve(__filename ?? "");
const FILES = SCANNED_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).filter(
  (file) => file !== SELF,
);

/**
 * An export list whose last slot is empty: `export { a, b,  }` or
 * `export type { A,  }`. A trailing comma against the brace is the repo's
 * multi-line style and stays legal; what this catches is the comma with
 * nothing but spaces after it on the SAME line.
 */
const EMPTY_EXPORT_SLOT = /export\s+(?:type\s+)?\{[^}\n]*,[ \t]+\}/;

/** A statement that is nothing but a semicolon. */
const BARE_SEMICOLON = /^[ \t]*;[ \t]*$/;

describe("hand-written source fence", () => {
  it("scans the source tree", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("leaves no export list with an empty last slot", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (EMPTY_EXPORT_SLOT.test(line)) offenders.push(`${relative(ROOT, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no statement that is only a semicolon", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (BARE_SEMICOLON.test(line)) offenders.push(`${relative(ROOT, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
