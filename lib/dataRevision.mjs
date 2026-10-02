// WHICH REVISION A BUILD STAMPS ITS DATA AND ITS SERVICE WORKER WITH.
//
// One build produces one set of shard payloads, one service-worker marker and
// one Next deployment id, and all three have to answer the same revision or a
// browser holding yesterday's shard is handed today's manifest. The release
// environment normally supplies it: Vercel's own build carries
// VERCEL_DEPLOYMENT_ID, GitHub Actions carries GITHUB_SHA.
//
// A build with NO such environment is the case this module exists for. Measured
// 2026-09-05 from a clean worktree: `vercel pull --environment=production`
// writes VERCEL_GIT_COMMIT_SHA="" and no VERCEL_DEPLOYMENT_ID, so a local
// production build died at next.config.mjs before it compiled a line -
// `Error: A deploy revision is required for production builds`. The tree the
// build is running over already names itself, so the working-tree commit is the
// answer, and the refusal is kept for the one case that can name nothing: no
// environment AND no git.
//
// Plain ESM with a .d.mts sidecar (the lib/buildInfo.mjs idiom), because
// next.config.mjs cannot import TypeScript and scripts/lib/slimShards.mjs must
// read the same rule rather than a second copy of it.

import { execFileSync } from "node:child_process";

/** How many characters of a commit a revision spends. */
export const WORKING_TREE_REVISION_LENGTH = 12;

/** The marker a build with no release environment and no production stamp uses. */
export const LOCAL_DATA_REVISION = "local";

const firstNonEmpty = (...values) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim();

/**
 * The revision the release environment stated, or null when it stated none.
 * Order is deliberate: the most specific claim about THIS deploy wins.
 */
export function environmentDataRevision(env = {}) {
  return (
    firstNonEmpty(
      env.NEXT_PUBLIC_SW_VERSION,
      env.DEPLOYMENT_VERSION,
      env.VERCEL_DEPLOYMENT_ID,
      env.VERCEL_GIT_COMMIT_SHA,
      env.GITHUB_SHA,
    ) ?? null
  );
}

/**
 * A commit shortened to a revision, or null. Next refuses a deployment id over
 * 32 characters, so a full 40-character sha cannot be spent here.
 */
export function revisionFromCommitSha(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase().slice(0, WORKING_TREE_REVISION_LENGTH);
}

/** HEAD of the tree the build is running over, or null when git cannot answer. */
export function readWorkingTreeCommitSha(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // No git, no repository, or a shallow copy with no HEAD. Reported as absent.
    return null;
  }
}

/**
 * The revision a build stamps, from the environment first and the working tree
 * second, or null when neither answered.
 */
export function resolveDataRevision(env = {}, { workingTreeSha = null } = {}) {
  return environmentDataRevision(env) ?? revisionFromCommitSha(workingTreeSha);
}

/** The sentence a build that can name no revision refuses with. */
export const NO_DATA_REVISION_REFUSAL =
  "A deploy revision is required for production builds: no NEXT_PUBLIC_SW_VERSION, " +
  "DEPLOYMENT_VERSION, VERCEL_DEPLOYMENT_ID, VERCEL_GIT_COMMIT_SHA or GITHUB_SHA, " +
  "and git could not name HEAD for this tree.";

/**
 * The revision, decided. A production build with nothing to name itself with
 * REFUSES rather than shipping data a browser cannot tell apart from another
 * build's; every other build takes the stable local marker, because no worker
 * from a local build can cross into production.
 */
export function requireDataRevision(env = {}, { workingTreeSha = null } = {}) {
  const resolved = resolveDataRevision(env, { workingTreeSha });
  if (resolved) return resolved;
  if (env.NODE_ENV === "production") throw new Error(NO_DATA_REVISION_REFUSAL);
  return LOCAL_DATA_REVISION;
}
