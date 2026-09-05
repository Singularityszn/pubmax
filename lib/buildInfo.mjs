// Which commit the running code was BUILT from, decided once at build time.
//
// A deployment id names WHICH deploy answered; it does not name WHAT is in it.
// The route used to read VERCEL_GIT_COMMIT_SHA at REQUEST time, and Vercel only
// puts that variable in the environment of a build it owns through the Git
// integration: a `vercel deploy` from a CLI answered null for ever, so three
// preview verifications in a row had to go through the Vercel deployment API to
// learn what they were looking at. So the question is asked ONCE, where the
// answer exists - in next.config.mjs, during the build - and the answer is
// inlined into the bundle. Nothing runs git per request.
//
// Plain ESM with a .d.mts sidecar (the lib/pintIndexCanonical.mjs idiom),
// because next.config.mjs cannot import TypeScript and the route and the tests
// must read the same rule.

/** The closed set of ways a build can learn its own commit. */
export const BUILD_COMMIT_SOURCES = Object.freeze({
  /** Vercel's Git integration stamped the build environment. */
  vercelGit: "vercel-git",
  /** The build read the commit of the working tree it was building. */
  workingTree: "working-tree",
});

const COMMIT_SOURCE_VALUES = Object.freeze(Object.values(BUILD_COMMIT_SOURCES));

/**
 * A commit sha or null. A short sha is a real thing a CI system hands over, so
 * the floor is 7 hex characters rather than a full 40, and anything else - an
 * empty variable, a branch name, a placeholder - is absence rather than a guess.
 */
export function normalizeCommitSha(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** A source this module wrote, or null. Never a word a caller invented. */
export function normalizeCommitSource(value) {
  return COMMIT_SOURCE_VALUES.includes(value) ? value : null;
}

/** An ISO instant or null; an unparseable stamp is no stamp. */
export function normalizeBuildTime(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The commit a build is building, and where that answer came from. The platform
 * is asked first, because on a Git-integration deploy Vercel knows the commit it
 * checked out; the working tree answers for a CLI deploy, a self-hosted build
 * and a local one alike. A verifier can tell them apart, because a working-tree
 * answer describes the machine that ran the build rather than a pushed commit.
 */
export function resolveBuildCommit(env = {}, workingTreeSha = null) {
  const fromVercel = normalizeCommitSha(env.VERCEL_GIT_COMMIT_SHA);
  if (fromVercel) {
    return { commitSha: fromVercel, commitShaSource: BUILD_COMMIT_SOURCES.vercelGit };
  }

  // A CLI deploy uploads no repository, so the tree it came from is named by the
  // deploy command itself (scripts/deploy-vercel.mjs, deployStampBuildEnv below)
  // and arrives as a build variable. It is the same claim a builder-side git read
  // makes - this is the tree the build ran over - so it wears the same source.
  const fromDeployCommand = normalizeCommitSha(env.PUBMAX_BUILD_COMMIT_SHA);
  if (fromDeployCommand) {
    return { commitSha: fromDeployCommand, commitShaSource: BUILD_COMMIT_SOURCES.workingTree };
  }

  const fromWorkingTree = normalizeCommitSha(workingTreeSha);
  if (fromWorkingTree) {
    return { commitSha: fromWorkingTree, commitShaSource: BUILD_COMMIT_SOURCES.workingTree };
  }

  // Neither answered. Null is the honest reading: a build that cannot name its
  // own commit says so rather than naming somebody else's.
  return { commitSha: null, commitShaSource: null };
}

/** The whole stamp a build hands the running code. */
export function resolveBuildStamp(env = {}, { workingTreeSha = null, now = new Date() } = {}) {
  return { ...resolveBuildCommit(env, workingTreeSha), builtAt: now.toISOString() };
}

/**
 * The stamp read back out of the environment the build inlined it into. Every
 * field is normalized on the way out too, so a hand-set variable cannot make
 * /api/version claim a commit that is not one.
 */
export function readBuildStamp(env = {}) {
  const commitSha = normalizeCommitSha(env.PUBMAX_BUILD_COMMIT_SHA);
  return {
    commitSha,
    // A source with no sha beside it names nothing, so it goes with the sha.
    commitShaSource: commitSha ? normalizeCommitSource(env.PUBMAX_BUILD_COMMIT_SHA_SOURCE) : null,
    builtAt: normalizeBuildTime(env.PUBMAX_BUILD_TIME),
  };
}

/**
 * What a deploy command has to hand the build so the build can name the commit.
 *
 * MEASURED 2026-09-05 against a preview: `vercel deploy` from a CLI uploads no
 * .git directory and Vercel stamps no VERCEL_GIT_COMMIT_SHA on either the build
 * or the runtime of such a deploy, so the builder cannot ask git and the answer
 * has to travel with the upload. scripts/deploy-vercel.mjs carries it.
 *
 * A DIRTY TREE STAMPS NOTHING. The files a CLI deploy uploads are the working
 * tree, so over a dirty tree the commit names code that is not what was sent,
 * and a marker that names the wrong commit is worse than one that names none.
 */
export function deployStampBuildEnv({ headSha = null, dirty = false } = {}) {
  const commitSha = dirty ? null : normalizeCommitSha(headSha);
  if (!commitSha) return {};
  return { PUBMAX_BUILD_COMMIT_SHA: commitSha };
}
