#!/usr/bin/env node
// ONE COMMAND: a PREVIEW deployment, built with the production values that can
// be read, from a clean worktree.
//
// The recipe this replaces was three commands from a verification brief -
// `vercel pull --environment=production`, `vercel build --prod`,
// `vercel deploy --prebuilt` - and MEASURED 5 September 2026 it failed four
// times in a row for four different reasons before a verifier could look at a
// single page. Each is fixed at its source and named here so nobody rebuilds
// the broken sequence:
//
//  1. The build could not name its own data revision. A pulled production
//     environment carries VERCEL_GIT_COMMIT_SHA="" and no VERCEL_DEPLOYMENT_ID,
//     so next.config.mjs and scripts/lib/slimShards.mjs both refused. Fixed in
//     lib/dataRevision.mjs: the tree the build runs over names the revision.
//  2. A `--prod`-built output cannot deploy to a preview target, and the way
//     round it was to edit `.vercel/output/builds.json` by hand. Gone: the
//     build runs in the cloud, so there is one target and no metadata to edit.
//  3. The upload traced the whole project and died on a file `.vercelignore`
//     keeps out of it. Fixed in lib/venueIndexOsm.ts.
//  4. sharp shipped darwin-only, so every route importing it answered 500.
//     Cannot happen here: a cloud build installs the linux binaries, and this
//     command REFUSES `--prebuilt` so a Mac cannot ship its own again.
//
// It never promotes and never touches a stored environment variable. `vercel
// pull` is a read; every production value it hands back rides on THIS deploy
// alone, so one verifier's run cannot change what the next deploy does.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyPulledEnv, deployEnvFlags, refusedFlagReason } from "./lib/previewProdEnv.mjs";
import { vercelCommand } from "./lib/vercelCli.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PULLED_ENV_FILE = path.join(projectRoot, ".vercel", ".env.production.local");

const forwardedArgs = process.argv.slice(2);
const refused = refusedFlagReason(forwardedArgs);
if (refused) {
  console.error(`Refusing ${refused.flag}: ${refused.reason}`);
  process.exit(1);
}

const pullArgs = ["pull", "--yes", "--environment=production"];
const pull = vercelCommand(pullArgs);
console.log("Reading the production environment (a read; nothing is written to Vercel).");
const pulled = spawnSync(pull.command, pull.args, { cwd: projectRoot, stdio: "inherit" });
if (pulled.error) {
  console.error(`Could not run ${pull.command}: ${pulled.error.message}`);
  process.exit(1);
}
if (pulled.status !== 0) {
  console.error(
    "`vercel pull --environment=production` failed, so this deploy has no production\n" +
      "  values to carry. Check the link (`vercel link --project <name>`) and the login\n" +
      "  (`vercel login`), then run this again.",
  );
  process.exit(pulled.status ?? 1);
}

let pulledContents;
try {
  pulledContents = readFileSync(PULLED_ENV_FILE, "utf8");
} catch (error) {
  console.error(
    `Could not read ${path.relative(projectRoot, PULLED_ENV_FILE)}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

const { forwarded, sensitive, platform } = classifyPulledEnv(pulledContents);

// A name, never a value: this line goes to a terminal and often into a report.
console.log(
  `Carrying ${forwarded.length} production value(s): ${
    forwarded.map(([name]) => name).join(", ") || "none"
  }`,
);
if (sensitive.length) {
  console.log(
    `Vercel would not hand back ${sensitive.length} secret value(s), so this preview\n` +
      `  falls back to the project's own Preview environment for them:\n` +
      `  ${sensitive.join(", ")}`,
  );
}
if (platform.length) {
  console.log(
    `Leaving ${platform.length} platform-owned name(s) to Vercel, VERCEL_ENV among them:\n` +
      "  a preview that called itself production would be indexable.",
  );
}

// The deploy itself stays with the ONE command that owns a CLI deploy here, so
// the project print, the commit stamp and the dirty-tree rule are not restated.
const deployScript = path.join(projectRoot, "scripts", "deploy-vercel.mjs");
const deploy = spawnSync(
  process.execPath,
  [deployScript, ...deployEnvFlags(forwarded), ...forwardedArgs],
  { cwd: projectRoot, stdio: "inherit" },
);

if (deploy.error) {
  console.error(`Could not run the deploy: ${deploy.error.message}`);
  process.exit(1);
}

if (deploy.status === 0) {
  const head = (() => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  })();
  console.log(
    "\nProve what the preview serves:\n" +
      "  curl -s <deployment-url>/api/version" +
      (head ? `\n  gitCommitSha should read ${head}` : ""),
  );
}

process.exit(deploy.status ?? 1);
