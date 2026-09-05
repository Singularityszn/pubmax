#!/usr/bin/env node
// Deploy to Vercel with the commit the upload came from.
//
// MEASURED 2026-09-05 (preview dpl_CgDWoXWduiQJyFBwJPEYSHTsdcB8): a bare
// `vercel deploy` uploads no .git directory and Vercel stamps no
// VERCEL_GIT_COMMIT_SHA on either the build or the runtime of a CLI deploy, so
// the builder has nothing to ask and /api/version answered null on exactly the
// previews a verifier needed to identify. The answer therefore has to travel
// with the upload: this script reads the commit HERE and passes it as a build
// variable, which lib/buildInfo.mjs reads in next.config.mjs. A deploy through
// Vercel's Git integration needs none of this and is untouched.
//
// A DIRTY TREE STAMPS NOTHING, because a CLI deploy uploads the working tree
// and the commit would then name code that was not sent. Every argument is
// forwarded, so `npm run deploy:preview -- --prod` is still the operator's call
// rather than this script's.

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deployStampBuildEnv } from "../lib/buildInfo.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

const headSha = git(["rev-parse", "HEAD"]);
const statusOutput = git(["status", "--porcelain"]);
// A status we could not read is not a clean tree: it is an unread tree, and the
// safe reading of an unread tree is the one that stamps nothing.
const dirty = statusOutput === null || statusOutput.trim() !== "";

const buildEnv = deployStampBuildEnv({ headSha, dirty });
const stampedSha = buildEnv.PUBMAX_BUILD_COMMIT_SHA ?? null;

if (stampedSha) {
  console.log(`Deploying commit ${stampedSha}; /api/version will name it.`);
} else if (headSha && dirty) {
  console.warn(
    "Working tree is dirty (or its status could not be read), so no commit is stamped:\n" +
      "  the upload is not the commit, and /api/version answers null rather than naming the wrong one.\n" +
      "  Commit the tree to get an identifiable deploy.",
  );
} else {
  console.warn(
    "No commit found for this tree, so /api/version will answer null for this deploy.",
  );
}

const args = [
  "deploy",
  ...Object.entries(buildEnv).flatMap(([key, value]) => ["--build-env", `${key}=${value}`]),
  ...process.argv.slice(2),
];

const result = spawnSync("vercel", args, { cwd: projectRoot, stdio: "inherit" });

if (result.error) {
  console.error(`Could not run vercel: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
