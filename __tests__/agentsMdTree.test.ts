import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { agentsMdFiles } from "./helpers/agentsMdTree";
import { defined } from "@/__tests__/helpers/defined";

// THE ROOT AGENTS.md IS AN INDEX, AND AN INDEX THAT HAS DRIFTED IS WORSE THAN NONE.
//
// The document was one 359 KB file with three headings, so every agent paid for
// every area's rules whatever it was editing. It is a tree now: a short root
// carrying the laws that apply everywhere plus a table, and one area file per
// area. That is the shape both harnesses already load: Claude Code and Codex
// each read the NEAREST `AGENTS.md` up the tree from the file being edited.
//
// That shape has three ways to rot, and this file holds each one:
// a table row pointing at a file nobody kept, an area file no row names (so
// nothing tells a reader it exists), and a root that grows back into the
// document it was split out of.
const ROOT = resolve(process.cwd());
const ROOT_DOC = join(ROOT, "AGENTS.md");

/**
 * The root index may not grow back into the document. 12 KB is roughly three
 * of the old file's longer entries: enough for the laws and the table, far too
 * little for an area's rules, which is the point.
 */
const ROOT_MAX_BYTES = 12 * 1024;

/**
 * Every level-2 and level-3 heading of the pre-split AGENTS.md, snapshotted
 * from `git show origin/main:AGENTS.md` at the split. Each must still be a
 * heading somewhere in the tree, and in exactly one file, so a section cannot
 * be dropped in a later trim or copied into two places to be edited twice.
 */
const PRE_SPLIT_HEADINGS = [
  "Cursor Cloud specific instructions",
  "Agent skills",
  "Issue tracker",
  "Triage labels",
  "Domain docs",
  "Maintaining this file",
];

const TABLE_LINK = /\[`([^`]+AGENTS\.md)`\]\(([^)]+)\)/g;

function rootTablePointers(): string[] {
  const doc = readFileSync(ROOT_DOC, "utf8");
  const rows = doc
    .split("\n")
    .filter((line) => line.startsWith("| [`") && line.includes("AGENTS.md"));
  const pointers = new Set<string>();

  for (const row of rows) {
    for (const match of row.matchAll(TABLE_LINK)) {
      expect(
        match[1],
        "the table's label and its link must name one file",
      ).toBe(match[2]);
      pointers.add(defined(match[1]));
    }
  }

  return [...pointers].sort();
}

function headingsOf(file: string): string[] {
  return readFileSync(join(ROOT, file), "utf8")
    .split("\n")
    .filter((line) => /^#{2,3} /.test(line))
    .map((line) => line.replace(/^#{2,3} /, "").trim());
}

describe("the AGENTS.md tree", () => {
  it("points every table row at a file that is here", () => {
    const missing = rootTablePointers().filter(
      (pointer) => !existsSync(join(ROOT, pointer)),
    );
    expect(missing, "the root index names area files that are gone").toEqual(
      [],
    );
  });

  it("names every area file in the tree, so none is unreachable", () => {
    const areaFiles = agentsMdFiles(ROOT).filter(
      (file) => file !== "AGENTS.md",
    );
    expect(rootTablePointers()).toEqual(areaFiles.sort());
  });

  it("keeps the root an index rather than the document", () => {
    expect(statSync(ROOT_DOC).size).toBeLessThan(ROOT_MAX_BYTES);
  });

  it("keeps every pre-split heading, in exactly one file", () => {
    const owners = new Map<string, string[]>(
      PRE_SPLIT_HEADINGS.map((heading) => [heading, []]),
    );

    for (const file of agentsMdFiles(ROOT)) {
      for (const heading of headingsOf(file)) {
        owners.get(heading)?.push(file);
      }
    }

    expect(
      Object.fromEntries(
        [...owners].map(([heading, files]) => [heading, files.length]),
      ),
    ).toEqual(
      Object.fromEntries(PRE_SPLIT_HEADINGS.map((heading) => [heading, 1])),
    );
  });
});
