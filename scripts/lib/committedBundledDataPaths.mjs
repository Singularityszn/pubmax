// Tracked bundled-data trees that verification checks and browser builds may rewrite.
// Browser builds restore tracked outputs from HEAD. A builder can also write a shard file HEAD does not
// have. A new untracked file may belong to a concurrent writer, so the
// wrapper preserves it and fails after cleanup unless the browser caller opts in.
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
  const result = spawnSync("git", [
    "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=no", "--",
    ...COMMITTED_BUNDLED_DATA_PATHS,
  ], { cwd, stdio: ["ignore", "pipe", "inherit"] });
  return result.status === 0 && result.stdout.length === 0;
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
 * @param {{ untrackedBefore?: Set<string> | null, allowNewUntracked?: boolean }} [options] untracked files
 *   that existed before the wrapped command. New files are preserved and
 *   reported because their writer cannot be identified safely. Only browser
 *   builds opt into allowing new files.
 * @returns {boolean} false on Git failures or new untracked files without opt-in.
 */
export function restoreCommittedBundledData(cwd = process.cwd(), { untrackedBefore = null, allowNewUntracked = false } = {}) {
  let ok = true;
  for (const rel of COMMITTED_BUNDLED_DATA_PATHS) {
    const listed = spawnSync("git", ["ls-files", "-z", "--", rel], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (listed.status !== 0) {
      ok = false;
      continue;
    }
    if (!listed.stdout.replace(/\0/g, "").trim()) continue;

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
      if (!allowNewUntracked) ok = false;
    }
  }
  return ok;
}

/** @param {string[]} trackedOutputs entries from PUBMAX_TRACKED_OUTPUTS */
export function shouldRestoreBundledDataAfterTrackedOutputs(trackedOutputs) {
  const normalized = trackedOutputs.map((value) => value.trim().replace(/\/$/, ""));
  return COMMITTED_BUNDLED_DATA_PATHS.some((path) => normalized.includes(path));
}
