import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { agentsMdFiles } from "./helpers/agentsMdTree";
import { defined } from "@/__tests__/helpers/defined";

// THE AGENTS.md TREE IS WHAT EVERY AGENT READS BEFORE IT OPENS A SOURCE FILE.
//
// Claude Code and Codex each read the NEAREST `AGENTS.md` up the tree from the
// file being edited, plus the root. That read is paid on every task, so its size
// is a budget: a short root with the laws that apply everywhere and a table, and
// one area file per area holding only the traps the code cannot show. Long rules
// live under `docs/rules/` and are read only for the rule being changed.

const ROOT = resolve(process.cwd());
const ROOT_DOC = join(ROOT, "AGENTS.md");

/**
 * Byte budgets for the mandatory read path. Like a performance ceiling, a
 * budget comes down with the measured size and goes up only in the commit
 * that needs it, with the reason and the captain's word.
 */
const ROOT_MAX_BYTES = 9 * 1024;
const AREA_MAX_BYTES = 4 * 1024;

const TABLE_LINK = /\[`([^`]+AGENTS\.md)`\]\(([^)]+)\)/g;

function rootTablePointers(): string[] {
  const doc = readFileSync(ROOT_DOC, "utf8");
  const rows = doc
    .split("\n")
    .filter((line) => line.startsWith("|") && line.includes("AGENTS.md"));
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

  it("keeps the root inside its byte budget", () => {
    expect(statSync(ROOT_DOC).size).toBeLessThanOrEqual(ROOT_MAX_BYTES);
  });

  it("keeps every area file inside its byte budget", () => {
    const oversized = agentsMdFiles(ROOT)
      .filter((file) => file !== "AGENTS.md")
      .map((file) => ({ file, bytes: statSync(join(ROOT, file)).size }))
      .filter(({ bytes }) => bytes > AREA_MAX_BYTES);
    expect(oversized, "move long rules into docs/rules/").toEqual([]);
  });
});
