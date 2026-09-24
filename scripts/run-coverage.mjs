#!/usr/bin/env node
/**
 * Entry point for `npm run coverage`.
 *
 * npm appends `npm run coverage -- <args>` to the end of the script, so a
 * script of two chained vitest commands handed a clusterless CI job's
 * `--exclude` globs to the second command instead of the coverage run. One
 * node process takes those arguments and gives them to the coverage run
 * alone, then runs the SysV harness proof on its own, serially, unless
 * those arguments exclude it: a job with no cluster would only report its
 * proofs skipped.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SERIAL_SHM_RUN } from "./rls/postgresSuites.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = join(REPO_ROOT, "node_modules/.bin/vitest");

function vitest(args, extraEnv = {}) {
  const result = spawnSync(vitestBin, ["run", ...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const forwarded = process.argv.slice(2);
const excluded = new Set(
  forwarded.filter((_, index) => index > 0 && forwarded[index - 1] === "--exclude"),
);

vitest(["--coverage", "--maxWorkers=4", ...forwarded]);
if (!SERIAL_SHM_RUN.suites.every((suite) => excluded.has(suite))) {
  vitest([...SERIAL_SHM_RUN.suites, "--maxWorkers=1"], SERIAL_SHM_RUN.env);
}
