// Tracked bundled-data trees the merge bar and browser builds may rewrite.
// Restore them from HEAD after a wrapped command so pipeline Push steps never
// pick up generator churn. A builder can also write a shard file HEAD does not
// have, and `git restore` leaves an untracked file alone, so a restore also
// removes the untracked files the wrapped command created, and the folders that
// removal empties. A publisher reads an empty generation folder as published.
// A no-mistakes CI repair runs builders outside any wrapper, so the Review
// scope check fails a CI-step commit that touches these trees
// (scripts/check_review_scope.mjs).

import { spawnSync } from "node:child_process";
import { readdirSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

/** Paths that may be dirtied by builders; restore only when git tracks files under them. */
export const COMMITTED_BUNDLED_DATA_PATHS = ["public/data"];

/**
 * Whether a repository path is bundled data: a file under a bundled tree that
 * is not one of the Markdown notes documenting it.
 * @param {string} path
 */
export function isBundledDataFile(path) {
  return (
    !path.endsWith(".md") &&
    COMMITTED_BUNDLED_DATA_PATHS.some((root) => path.startsWith(`${root}/`))
  );
}

/**
 * Untracked, unignored files under the bundled trees, or null when git cannot answer.
 * @param {string} [cwd]
 * @returns {Set<string> | null}
 */
export function untrackedBundledData(cwd = process.cwd()) {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard", "--", ...COMMITTED_BUNDLED_DATA_PATHS],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (listed.status !== 0) return null;
  return new Set(listed.stdout.split("\0").filter(Boolean));
}

/**
 * Removes each folder above a bundled file that is now empty, up to its bundled root.
 * @param {string} cwd
 * @param {string} path
 */
function removeEmptyParents(cwd, path) {
  const root = COMMITTED_BUNDLED_DATA_PATHS.find((candidate) => path.startsWith(`${candidate}/`));
  if (!root) return;
  for (let dir = dirname(path); dir !== root; dir = dirname(dir)) {
    const absolute = join(cwd, dir);
    if (readdirSync(absolute).length > 0) return;
    rmdirSync(absolute);
  }
}

/**
 * @param {string} [cwd]
 * @param {{ untrackedBefore?: Set<string> | null }} [options] untracked files
 *   that existed before the wrapped command. Every other untracked file under
 *   the bundled trees is removed. Without a snapshot no untracked file is removed.
 * @returns {boolean} false when git restore failed for a path that has tracked files
 */
export function restoreCommittedBundledData(cwd = process.cwd(), { untrackedBefore = null } = {}) {
  let ok = true;
  for (const rel of COMMITTED_BUNDLED_DATA_PATHS) {
    const listed = spawnSync("git", ["ls-files", "-z", "--", rel], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (listed.status !== 0 || !listed.stdout.replace(/\0/g, "").trim()) continue;

    const restore = spawnSync(
      "git",
      ["restore", "--worktree", "--source=HEAD", "--", rel],
      { cwd, stdio: "inherit" },
    );
    if (restore.status !== 0) ok = false;
  }
  if (untrackedBefore) {
    const untrackedAfter = untrackedBundledData(cwd);
    if (!untrackedAfter) return false;
    for (const path of untrackedAfter) {
      if (untrackedBefore.has(path)) continue;
      rmSync(join(cwd, path), { force: true });
      removeEmptyParents(cwd, path);
    }
  }
  return ok;
}

/** @param {string[]} trackedOutputs entries from PUBMAX_TRACKED_OUTPUTS */
export function shouldRestoreBundledDataAfterTrackedOutputs(trackedOutputs) {
  const normalized = trackedOutputs.map((value) => value.trim().replace(/\/$/, ""));
  return COMMITTED_BUNDLED_DATA_PATHS.some((path) => normalized.includes(path));
}
