// THE ONE INVENTORY OF POSTGRES-BACKED PROOFS.
//
// Three lists used to disagree: the suites that boot a cluster, the suites
// `npm run test:rls` runs, and the suites the CI jobs with no PostgreSQL
// exclude. On 5 September 2026 three new migration proofs landed outside the
// only job that installs a cluster, printed a skip banner to stderr, and left
// that job green. This file holds all three to each other, and holds every
// proof to the ONE harness, so a hand-copied binary search cannot come back.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { POSTGRES_BACKED_SUITES } from "../scripts/rls/postgresSuites.mjs";

const ROOT = process.cwd();
const TESTS_DIR = join(ROOT, "__tests__");

const HARNESS_IMPORTS = ["./helpers/postgres", "scripts/rls/session-harness.mjs"];

/** This file NAMES the harness without booting one, so it is not a proof. */
const INVENTORY_FILE = "postgresSuiteInventory.test.ts";

function testFiles(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"))
    .filter((name) => name !== INVENTORY_FILE)
    .sort();
}

function readsTheHarness(name: string): boolean {
  const source = readFileSync(join(TESTS_DIR, name), "utf8");
  return HARNESS_IMPORTS.some((specifier) => source.includes(specifier));
}

describe("the Postgres proof inventory", () => {
  it("names exactly the suites that boot a cluster", () => {
    const observed = testFiles()
      .filter(readsTheHarness)
      .map((name) => `__tests__/${name}`);
    expect(observed).toEqual([...POSTGRES_BACKED_SUITES]);
  });

  it("leaves every proof one binary search and one skip predicate", () => {
    const offenders = testFiles().filter((name) => {
      const source = readFileSync(join(TESTS_DIR, name), "utf8");
      return (
        /function\s+(missingPostgresReason|findPostgresBinary|postgresBinary)\s*\(/.test(
          source,
        ) || /execFileSync\(\s*initdb/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("is the list npm run test:rls runs", () => {
    const runner = readFileSync(join(ROOT, "scripts/rls/run-session-tests.mjs"), "utf8");
    expect(runner).toContain('import { POSTGRES_BACKED_SUITES } from "./postgresSuites.mjs"');
    expect(runner).toContain("const SERIAL_SHM_SUITE");
  });

  it("is the list the clusterless CI jobs exclude", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    for (const suite of POSTGRES_BACKED_SUITES) {
      // Once for `unit-tests`, once for `coverage`: neither installs Postgres.
      const occurrences = workflow.split(`--exclude '${suite}'`).length - 1;
      expect(occurrences, `${suite} must be excluded by both clusterless jobs`).toBe(2);
    }
  });

  it("runs the proofs in the job that installs the cluster", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/rls-session.yml"), "utf8");
    expect(workflow).toContain("postgresql-16");
    expect(workflow).toContain("npm run test:rls");
  });

  it("fails a run whose proofs were skipped, and says how to admit one", () => {
    const refused = spawnSync(process.execPath, ["scripts/rls/run-session-tests.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PUBMAX_RLS_NO_PG: "1", PUBMAX_RLS_ALLOW_SKIP: "" },
    });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("THIS IS NOT A PASS");
    expect(refused.stdout).toContain("PUBMAX_RLS_ALLOW_SKIP=1");

    const admitted = spawnSync(process.execPath, ["scripts/rls/run-session-tests.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PUBMAX_RLS_NO_PG: "1", PUBMAX_RLS_ALLOW_SKIP: "1" },
    });
    expect(admitted.status).toBe(0);
    expect(admitted.stdout).toContain("THIS IS NOT A PASS");
  });
});
