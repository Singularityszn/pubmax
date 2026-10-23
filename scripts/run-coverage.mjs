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
 *
 * `--without-postgres` excludes every suite in scripts/rls/postgresSuites.mjs.
 * The CI unit shards install no cluster, and `npm run verify` runs those
 * suites once in `npm run test:rls`, so neither runs them here.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { POSTGRES_BACKED_SUITES, SERIAL_SHM_RUN } from "./rls/postgresSuites.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = join(REPO_ROOT, "node_modules/.bin/vitest");

export const WITHOUT_POSTGRES = "--without-postgres";

/** The vitest invocations `npm run coverage -- <forwarded>` makes, in order. */
export function coverageRuns(forwarded) {
  const vitestArgs = forwarded.flatMap((arg) =>
    arg === WITHOUT_POSTGRES ? POSTGRES_BACKED_SUITES.flatMap((suite) => ["--exclude", suite]) : [arg],
  );
  const excluded = new Set(
    vitestArgs.filter((_, index) => index > 0 && vitestArgs[index - 1] === "--exclude"),
  );
  const runs = [{ args: ["run", "--coverage", "--maxWorkers=4", ...vitestArgs], env: {} }];
  if (!SERIAL_SHM_RUN.suites.every((suite) => excluded.has(suite))) {
    runs.push({ args: ["run", ...SERIAL_SHM_RUN.suites, "--maxWorkers=1"], env: SERIAL_SHM_RUN.env });
  }
  return runs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { args, env } of coverageRuns(process.argv.slice(2))) {
    const result = spawnSync(vitestBin, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
