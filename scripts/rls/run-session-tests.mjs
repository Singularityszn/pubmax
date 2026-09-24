#!/usr/bin/env node
/**
 * Entry point for `npm run test:rls`.
 *
 * A SKIPPED PROOF IS A FAILURE. Before this file exited 1 on a skip, the whole
 * security-proof layer - the permission matrix included - reported green on any
 * host without PostgreSQL, and with GitHub Actions off that was every host.
 * The banner said "THIS IS NOT A PASS" and the process said 0, so nothing acted
 * on it.
 *
 * The one way to admit a skip is to say so: PUBMAX_RLS_ALLOW_SKIP=1 prints the
 * same banner and exits 0, for a host that genuinely cannot install a cluster.
 *
 * Never applies migrations to a live Supabase project.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { missingPostgresReason } from "./postgresHost.mjs";
import { POSTGRES_BACKED_SUITES } from "./postgresSuites.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

/** Every suite that needs a cluster runs here, because this job installs one. */
const SERIAL_SHM_SUITE = "__tests__/postgresShmHarness.test.ts";
const RLS_SUITES = POSTGRES_BACKED_SUITES.filter((suite) => suite !== SERIAL_SHM_SUITE);

const missing = missingPostgresReason();
const skipAdmitted = process.env.PUBMAX_RLS_ALLOW_SKIP === "1";

function box(line) {
  return `║  ${line.padEnd(68)}║`;
}

function printLoudSkip(reason, admitted) {
  const reasonLines = reason.split(/\s+/).reduce((lines, word) => {
    const current = lines.at(-1) ?? "";
    if (!current || `${current} ${word}`.length > 58) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
    return lines;
  }, []);
  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    box("RLS SESSION SUITE SKIPPED - THIS IS NOT A PASS"),
    "╠══════════════════════════════════════════════════════════════════════╣",
    ...RLS_SUITES.map((suite) => box(`  ${suite}`)),
    "╠══════════════════════════════════════════════════════════════════════╣",
    box("Effective proofs need local PostgreSQL 16 (initdb/postgres/psql)."),
    box("They were NOT executed. A green step with this banner still means"),
    box("zero policy proofs ran on this host."),
    "╠══════════════════════════════════════════════════════════════════════╣",
    ...reasonLines.map((line, index) => box(`${index === 0 ? "Reason: " : "        "}${line}`)),
    "╠══════════════════════════════════════════════════════════════════════╣",
    box("Provision PostgreSQL 16 + PostgREST 14, then rerun locally."),
    box(
      admitted
        ? "PUBMAX_RLS_ALLOW_SKIP=1 admitted this skip, so the exit code is 0."
        : "This run FAILS. Set PUBMAX_RLS_ALLOW_SKIP=1 to admit the skip.",
    ),
    "╚══════════════════════════════════════════════════════════════════════╝",
    "",
  ];
  // stdout stays visible in CI logs even when test reporters mute stderr.
  process.stdout.write(lines.join("\n") + "\n");
}

if (missing) {
  printLoudSkip(missing, skipAdmitted);
  process.exit(skipAdmitted ? 0 : 1);
}

const vitestBin = join(REPO_ROOT, "node_modules/.bin/vitest");
function runSuites(suites, extraEnv = {}) {
  return spawnSync(
    vitestBin,
    [
      "run",
      ...suites,
      // Verbose + no silent: each test name and any skip reason stays in the log.
      "--reporter=verbose",
      "--silent=false",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    },
  );
}

const parallel = runSuites(RLS_SUITES);
if (parallel.status !== 0) process.exit(parallel.status ?? 1);

const serialShm = runSuites([SERIAL_SHM_SUITE], {
  PUBMAX_SERIAL_SHM_HARNESS: "1",
});
process.exit(serialShm.status ?? 1);
