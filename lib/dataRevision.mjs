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
// answer for a production build, and the refusal is kept for the one production
// case that can name nothing: no environment AND no git. `next dev` builds no
// packs, so it takes the revision stamped on the packs on disk: the committed
// `local`, or the SHA a local pack build restamped them with. It used to stamp
// the git SHA whatever the packs held, so the map rejected every one. Every
// other build ignores the tree and takes `local`.
//
// Plain ESM with a .d.mts sidecar (the lib/buildInfo.mjs idiom), because
// next.config.mjs cannot import TypeScript and scripts/lib/slimShards.mjs must
// read the same rule rather than a second copy of it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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

/** The revision stamped on the slim manifest in public/data, or null when it names none. */
export function readPackDataRevision(root = process.cwd()) {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(root, "public", "data", "venues_slim.manifest.json"), "utf8"),
    );
    return firstNonEmpty(manifest?.revision) ?? null;
  } catch {
    // No manifest, or one that is not JSON. Reported as absent.
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
 * Env for a pack build that runs in `prebuild`, before `next build` assigns
 * NODE_ENV. An unset NODE_ENV is that production data build: the packs have to
 * take the same working-tree revision the production service worker will.
 * `development` and `test` stay as they are. `next dev` does not call this.
 */
export function packBuildEnv(env = {}) {
  if (typeof env.NODE_ENV !== "string" || env.NODE_ENV.trim() === "") {
    return { ...env, NODE_ENV: "production" };
  }
  return env;
}

/**
 * The revision, decided. A production build with nothing to name itself with
 * REFUSES rather than shipping data a browser cannot tell apart from another
 * build's. A production build with no release environment takes the working
 * tree. Any other build given the packs' own revision takes it, so `next dev`
 * expects exactly the stamp on the packs it serves. The rest ignore the tree
 * and take the stable local marker, so no worker from a local build can cross
 * into production.
 */
export function requireDataRevision(env = {}, { workingTreeSha = null, packRevision = null } = {}) {
  if (env.NODE_ENV !== "production" && packRevision) return packRevision;
  const treeSha = env.NODE_ENV === "production" ? workingTreeSha : null;
  const resolved = resolveDataRevision(env, { workingTreeSha: treeSha });
  if (resolved) return resolved;
  if (env.NODE_ENV === "production") throw new Error(NO_DATA_REVISION_REFUSAL);
  return LOCAL_DATA_REVISION;
}
