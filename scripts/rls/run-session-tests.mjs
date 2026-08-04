#!/usr/bin/env node
/**
 * Entry point for `npm run test:rls`.
 *
 * When PostgreSQL binaries are absent, prints an UNMISSABLE skip banner to
 * stdout (not only stderr — Vitest can swallow console.error under the
 * default reporter) and exits 0. A skip is not a pass: the banner names the
 * suite, the reason, and that fact.
 *
 * When Postgres is present, runs the real session suite with a verbose
 * reporter so skip reasons cannot hide.
 *
 * Never applies migrations to a live Supabase project.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

const { missingPostgresReason } = await import(
  pathToFileURL(join(__dirname, "session-harness.mjs")).href
);

const missing = missingPostgresReason();

function printLoudSkip(reason) {
  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    "║  RLS SESSION SUITE SKIPPED — THIS IS NOT A PASS                      ║",
    "║  Suite: __tests__/rlsWave2Session.test.ts  (npm run test:rls)        ║",
    "╠══════════════════════════════════════════════════════════════════════╣",
    "║  Effective RLS tests need local PostgreSQL 16+ (initdb/postgres/psql)║",
    "║  They were NOT executed. A green CI step with this banner still means║",
    "║  zero policy proofs ran on this host.                                ║",
    "╠══════════════════════════════════════════════════════════════════════╣",
    `║  Reason: ${reason.slice(0, 60).padEnd(60)}║`,
  ];
  // Wrap remaining reason if long.
  let rest = reason.slice(60);
  while (rest.length > 0) {
    const chunk = rest.slice(0, 68);
    rest = rest.slice(68);
    lines.push(`║  ${chunk.padEnd(68)}║`);
  }
  lines.push(
    "╠══════════════════════════════════════════════════════════════════════╣",
    "║  Real proofs run on CI job `rls-session` (Postgres 16 service).      ║",
    "║  Do not treat this skip as evidence that RLS policies are correct.   ║",
    "╚══════════════════════════════════════════════════════════════════════╝",
    "",
  );
  // stdout: always visible in CI logs even when reporters mute stderr.
  process.stdout.write(lines.join("\n") + "\n");
  process.stderr.write(lines.join("\n") + "\n");
}

if (missing) {
  printLoudSkip(missing);
  // Exit 0: skip is correct on hosts without Postgres. Banner is the contract.
  process.exit(0);
}

const vitestBin = join(REPO_ROOT, "node_modules/.bin/vitest");
const result = spawnSync(
  vitestBin,
  [
    "run",
    "__tests__/rlsWave2Session.test.ts",
    // Verbose + no silent: each test name and any skip reason stays in the log.
    "--reporter=verbose",
    "--silent=false",
  ],
  {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
