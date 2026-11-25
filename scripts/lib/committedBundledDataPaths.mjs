// Tracked bundled-data trees the merge bar and browser builds may rewrite.
// Restore them from HEAD after a wrapped command so pipeline Push steps never
// pick up generator churn. A builder can also write a shard file HEAD does not
// have. A new untracked file may belong to a concurrent writer, so the
// wrapper preserves it and reports it for inspection without failing cleanup.
// A no-mistakes CI repair runs builders outside any wrapper, so the Review
// scope check fails a CI-step commit that touches these trees
// (scripts/check_review_scope.mjs).

import { spawnSync } from "node:child_process";

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

/** Refuse when restoring tracked data could overwrite caller changes. */
export function trackedBundledDataIsClean(cwd = process.cwd()) {
  return spawnSync("git", ["diff", "--quiet", "HEAD", "--", ...COMMITTED_BUNDLED_DATA_PATHS], {
    cwd, stdio: "inherit",
  }).status === 0;
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
 * @param {string} [cwd]
 * @param {{ untrackedBefore?: Set<string> | null }} [options] untracked files
 *   that existed before the wrapped command. New files are preserved and
 *   reported because their writer cannot be identified safely.
 * @returns {boolean} false when restoration or the untracked-file check fails.
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
    if ([...untrackedAfter].some((path) => !untrackedBefore.has(path))) {
      console.warn("New untracked bundled data was preserved for inspection.");
    }
  }
  return ok;
}

/** @param {string[]} trackedOutputs entries from PUBMAX_TRACKED_OUTPUTS */
export function shouldRestoreBundledDataAfterTrackedOutputs(trackedOutputs) {
  const normalized = trackedOutputs.map((value) => value.trim().replace(/\/$/, ""));
  return COMMITTED_BUNDLED_DATA_PATHS.some((path) => normalized.includes(path));
}
