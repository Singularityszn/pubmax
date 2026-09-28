// Tracked bundled-data trees the merge bar and browser builds may rewrite.
// Restore them from HEAD after a wrapped command so pipeline Push steps never
// pick up generator churn.

import { spawnSync } from "node:child_process";

/** Paths that may be dirtied by builders; restore only when git tracks files under them. */
export const COMMITTED_BUNDLED_DATA_PATHS = ["public/data", "uk_base/public/data"];

/**
 * @param {string} [cwd]
 * @returns {boolean} false when git restore failed for a path that has tracked files
 */
export function restoreCommittedBundledData(cwd = process.cwd()) {
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
  return ok;
}

/** @param {string[]} trackedOutputs entries from PUBMAX_TRACKED_OUTPUTS */
export function shouldRestoreBundledDataAfterTrackedOutputs(trackedOutputs) {
  const normalized = trackedOutputs.map((value) => value.trim().replace(/\/$/, ""));
  return COMMITTED_BUNDLED_DATA_PATHS.some((path) => normalized.includes(path));
}
