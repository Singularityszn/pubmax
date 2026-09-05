import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

// A SKIPPED RLS PROOF IS A FAILURE, and the banner alone was not enough: this
// runner printed "THIS IS NOT A PASS" and exited 0, so on every host without
// PostgreSQL the permission matrix reported green without running. The exit
// code is the contract now; the banner is how a reader knows why.

function runner(env: Record<string, string>) {
  return spawnSync("npm", ["run", "test:rls"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CI: "true", PUBMAX_RLS_ALLOW_SKIP: "", ...env },
  });
}

describe("RLS session runner", () => {
  it("fails when the proofs did not run", () => {
    const result = runner({ PUBMAX_RLS_NO_PG: "1" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("RLS SESSION SUITE SKIPPED");
    expect(result.stdout).toContain("THIS IS NOT A PASS");
    expect(result.stdout).toContain("__tests__/rlsWave2Session.test.ts");
    expect(result.stdout).toContain("__tests__/socialCrewMigration.test.ts");
    expect(result.stdout).toContain("__tests__/socialCrewLegacyRoutesRls.test.ts");
    expect(result.stdout).toContain("__tests__/permissionMatrixEffective.test.ts");
    expect(result.stdout).toContain("PostgreSQL 16 binaries not found");
    expect(result.stdout).toContain("They were NOT executed");
    expect(result.stdout).toContain("zero policy proofs ran on this host");
    expect(result.stdout).toContain("This run FAILS");
  });

  it("passes only when a host admits the skip on purpose", () => {
    const result = runner({ PUBMAX_RLS_NO_PG: "1", PUBMAX_RLS_ALLOW_SKIP: "1" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("THIS IS NOT A PASS");
    expect(result.stdout).toContain("admitted this skip");
  });
});
