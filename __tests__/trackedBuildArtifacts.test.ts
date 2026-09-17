import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A BUILD MAY NOT REWRITE A TRACKED FILE.
 *
 * `scripts/run-with-restored-next-env.mjs` diffs the tree around every wrapped
 * build and refuses one that changed a tracked file, which is what makes the
 * Performance budget and UX lane jobs trustworthy: they measure the tree that
 * was committed. An incremental-compiler cache is the easiest way to break
 * that, because `tsc -p tsconfig.build.json` writes one beside the config and
 * `git add -A` sweeps it in. `.gitignore` named `tsconfig.tsbuildinfo` alone,
 * so every other config's cache was trackable by accident.
 *
 * This fence reads the INDEX rather than the working tree: a file only breaks
 * a build when it is tracked.
 */
const ROOT = path.resolve(__dirname, "..");

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

describe("tracked build artifacts", () => {
  it("tracks no TypeScript incremental cache", () => {
    const tracked = trackedFiles().filter((file) => file.endsWith(".tsbuildinfo"));
    expect(tracked).toEqual([]);
  });

  it("ignores every TypeScript incremental cache, not just the default one", () => {
    const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    const lines = ignore.split("\n").map((line) => line.trim());
    expect(lines).toContain("*.tsbuildinfo");
  });
});
