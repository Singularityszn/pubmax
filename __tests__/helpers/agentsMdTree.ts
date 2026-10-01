import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { AGENT_TOOLING_PATHS } from "@/lib/agentToolingPaths.mjs";

/**
 * THE AGENTS.md TREE, FOUND THE WAY A HARNESS FINDS IT.
 *
 * Claude Code and Codex both read the NEAREST `AGENTS.md` up the tree from the
 * file being edited, so the split document is a set of files rather than one,
 * and any fence over it has to walk the same set. It walks the filesystem
 * rather than `git ls-tree`, because an area file a future agent has written
 * and not yet staged is exactly the file the fences exist to catch.
 *
 * Vendored packs under `.agents/skills/` may ship their own upstream
 * `AGENTS.md`. They are not ours, and `lib/agentToolingPaths.mjs` is already
 * the ONE list of what agent tooling writes into this checkout, so this reads
 * that list rather than starting a second one.
 */
const VENDORED = new Set(
  AGENT_TOOLING_PATHS.map((pattern) => pattern.split("/")[0]),
);
const BUILD_OUTPUT = new Set([
  ".git",
  "node_modules",
  "coverage",
  "playwright-report",
  "test-results",
]);

function skipped(name: string): boolean {
  return (
    VENDORED.has(name) || BUILD_OUTPUT.has(name) || name.startsWith(".next")
  );
}

/** Every `AGENTS.md` this tree owns, repo-relative, root first. */
export function agentsMdFiles(root: string): string[] {
  const found: string[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory)) {
      if (skipped(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry === "AGENTS.md") {
        found.push(relative(root, path).split(sep).join("/"));
      }
    }
  }

  walk(root);
  return found.sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
}
