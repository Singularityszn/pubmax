import { execFileSync, spawnSync } from "node:child_process";
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

function isIgnored(file: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", "--no-index", file], { cwd: ROOT }).status === 0;
}

describe("tracked build artifacts", () => {
  it("tracks no TypeScript incremental cache", () => {
    const tracked = trackedFiles().filter((file) => file.endsWith(".tsbuildinfo"));
    expect(tracked).toEqual([]);
  });

  it("ignores every TypeScript incremental cache, not just the default one", () => {
    expect(isIgnored("tsconfig.build.tsbuildinfo")).toBe(true);
  });

  // Next.js writes next-env.d.ts on every dev, build and typegen run, pointing
  // it at whichever dist dir ran last, so a tracked copy rode into reviews and
  // turned Review scope red. `npm run typecheck` runs `next typegen` first.
  it("never tracks next-env.d.ts and ignores it, which Next.js regenerates", () => {
    expect(trackedFiles()).not.toContain("next-env.d.ts");
    expect(isIgnored("next-env.d.ts")).toBe(true);
  });
});
