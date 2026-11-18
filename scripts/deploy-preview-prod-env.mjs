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

/**
 * The whole command, with every effect injectable so a test can capture the
 * deploy child's argv and environment without a Vercel login. Returns the exit
 * code; the direct-run guard below turns it into process.exit.
 */
export function runDeployPreviewProdEnv({
  argv = process.argv.slice(2),
  env = process.env,
  spawn = spawnSync,
  readFile = readFileSync,
  execFile = execFileSync,
  log = console.log,
  error = console.error,
  pulledEnvPath = PULLED_ENV_FILE,
  root = projectRoot,
} = {}) {
  const forwardedArgs = argv;
  const refused = refusedFlagReason(forwardedArgs);
  if (refused) {
    error(`Refusing ${refused.flag}: ${refused.reason}`);
    return 1;
  }

  const pullArgs = ["pull", "--yes", "--environment=production"];
  const pull = vercelCommand(pullArgs, env);
  log("Reading the production environment (a read; nothing is written to Vercel).");
  const pulled = spawn(pull.command, pull.args, { cwd: root, stdio: "inherit" });
  if (pulled.error) {
    error(`Could not run ${pull.command}: ${pulled.error.message}`);
    return 1;
  }
  if (pulled.status !== 0) {
    error(
      "`vercel pull --environment=production` failed, so this deploy has no production\n" +
        "  values to carry. Check the link (`vercel link --project <name>`) and the login\n" +
        "  (`vercel login`), then run this again.",
    );
    return pulled.status ?? 1;
  }

  let pulledContents;
  try {
    pulledContents = readFile(pulledEnvPath, "utf8");
  } catch (readError) {
    error(
      `Could not read ${path.relative(root, pulledEnvPath)}: ${
        readError instanceof Error ? readError.message : String(readError)
      }`,
    );
    return 1;
  }

  const { forwarded, sensitive, platform } = classifyPulledEnv(pulledContents);

  // A name, never a value: this line goes to a terminal and often into a report.
  log(
    `Carrying ${forwarded.length} production value(s): ${
      forwarded.map(([name]) => name).join(", ") || "none"
    }`,
  );
  if (sensitive.length) {
    log(
      `Vercel would not hand back ${sensitive.length} secret value(s), so this preview\n` +
        `  falls back to the project's own Preview environment for them:\n` +
        `  ${sensitive.join(", ")}`,
    );
  }
  if (platform.length) {
    log(
      `Leaving ${platform.length} platform-owned name(s) to Vercel, VERCEL_ENV among them:\n` +
        "  a preview that called itself production would be indexable.",
    );
  }

  // The deploy itself stays with the ONE command that owns a CLI deploy here, so
  // the project print, the commit stamp and the dirty-tree rule are not restated.
  const deployScript = path.join(root, "scripts", "deploy-vercel.mjs");
  const deploy = spawn(
    process.execPath,
    [deployScript, ...deployEnvFlags(forwarded), ...forwardedArgs],
    {
      cwd: root,
      stdio: "inherit",
      // A `NAME=value` argument is world-readable in `ps` output, so the flags
      // carry names only and each value rides in the child's environment.
      // deploy-vercel.mjs hands process.env to the Vercel CLI, whose
      // `--env NAME` / `--build-env NAME` flags read the value from it.
      env: { ...env, ...Object.fromEntries(forwarded) },
    },
  );

  if (deploy.error) {
    error(`Could not run the deploy: ${deploy.error.message}`);
    return 1;
  }

  if (deploy.status === 0) {
    const head = (() => {
      try {
        return execFile("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        return null;
      }
    })();
    log(
      "\nVerify the running commit with authenticated /api/version metadata.\n" +
        "  A public response names deploymentId only. Use an existing target-configured CRON_SECRET\n" +
        "  from the process environment, never a command argument or log.\n" +
        "  See docs/DEPLOYMENT.md: Which commit is this deploy serving." +
        (head ? `\n  gitCommitSha should read ${head}` : ""),
    );
  }

  return deploy.status ?? 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exit(runDeployPreviewProdEnv());
