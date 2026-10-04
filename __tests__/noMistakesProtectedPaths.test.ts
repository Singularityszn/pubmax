// AN AUTOMATIC FIX NEVER COMMITS BUNDLED DATA OR ANOTHER LANE'S FLAKE.
//
// On PR 1862 a no-mistakes CI repair ran a builder outside the restore
// wrappers and committed 111 stamped public/data files and next-env.d.ts, and
// CI repairs rewrote e2e/map-surface-history.spec.ts, a known flake, on five
// PRs. The CI step runs no repository command, so no wrapper can reach it.
// `protected_paths` in .no-mistakes.yaml refuses every automatic commit that
// would carry one of these paths and parks the step for the operator.
//
// no-mistakes globs have no negation and `*` never crosses a `/`: a pattern
// with no slash matches a basename at any depth, a `/**` suffix matches a
// subtree, and any other pattern is a whole-path glob. This fence applies
// those rules to every tracked file, so a data file deeper than the listed
// patterns fails here instead of slipping past the pipeline.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { isBundledDataFile } from "../scripts/lib/committedBundledDataPaths.mjs";

const ROOT = process.cwd();

type RepoConfig = { protected_paths?: string[]; ci?: { rerun_transient?: number } };

function repoConfig(): RepoConfig {
  return parse(readFileSync(join(ROOT, ".no-mistakes.yaml"), "utf8")) ?? {};
}

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`);
}

/** One no-mistakes glob against one repository path. */
function matchesProtectedPath(pattern: string, path: string): boolean {
  if (pattern.endsWith("/**")) {
    const root = pattern.slice(0, -3);
    return path === root || path.startsWith(`${root}/`);
  }
  if (!pattern.includes("/")) return globToRegExp(pattern).test(path.split("/").at(-1)!);
  return globToRegExp(pattern).test(path);
}

function isProtected(path: string): boolean {
  return (repoConfig().protected_paths ?? []).some((pattern) => matchesProtectedPath(pattern, path));
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

describe("the no-mistakes protected paths", () => {
  it("reads globs the way no-mistakes documents them", () => {
    expect(matchesProtectedPath("*.lock", "a/b/yarn.lock")).toBe(true);
    expect(matchesProtectedPath(".github/**", ".github/workflows/ci.yml")).toBe(true);
    expect(matchesProtectedPath("**/*.go", "internal/main.go")).toBe(true);
    expect(matchesProtectedPath("**/*.go", "internal/scm/github/github.go")).toBe(false);
  });

  it("protects every tracked bundled data file", () => {
    const data = trackedFiles.filter(isBundledDataFile);

    expect(data.length).toBeGreaterThan(1000);
    expect(data.filter((path) => !isProtected(path))).toEqual([]);
  });

  it("protects a new shard file a builder writes at any listed depth", () => {
    expect(isProtected("public/data/venues_slim.cell.51.000_0.000.json")).toBe(true);
    expect(isProtected("public/data/cities/bath/venues_slim.cell.51.000_0.000.json")).toBe(true);
  });

  it("leaves the data READMEs to the Document step", () => {
    const notes = trackedFiles.filter((path) => path.startsWith("public/data/") && path.endsWith(".md"));

    expect(notes.length).toBeGreaterThan(0);
    expect(notes.filter(isProtected)).toEqual([]);
  });

  it("protects the route-types file next dev and next build rewrite", () => {
    expect(isProtected("next-env.d.ts")).toBe(true);
  });

  it("names only known flakes that exist, and protects them", () => {
    const flakes = (repoConfig().protected_paths ?? []).filter((pattern) => pattern.startsWith("e2e/"));

    expect(flakes).toEqual(["e2e/map-surface-history.spec.ts"]);
    for (const flake of flakes) expect(existsSync(join(ROOT, flake))).toBe(true);
  });

  it("re-runs a failed check before the CI fixer reads it", () => {
    expect(repoConfig().ci?.rerun_transient).toBe(1);
  });
});
