import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("clean-main CI release gate", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

  it("runs a dedicated production build", () => {
    expect(workflow).toContain("name: Production build");
    expect(workflow).toMatch(/production-build:[\s\S]*run: npm run build/);
  });

  it("does not persist the workflow token in build checkouts", () => {
    const checkouts = workflow.match(/uses: actions\/checkout@v4/g) ?? [];
    const protectedCheckouts =
      workflow.match(
        /uses: actions\/checkout@v4\n\s+with:\n\s+persist-credentials: false/g,
      ) ?? [];

    expect(checkouts.length).toBeGreaterThan(0);
    expect(protectedCheckouts).toHaveLength(checkouts.length);
  });

  it("gives TypeScript and production Playwright builds enough heap", () => {
    expect(workflow).toMatch(
      /name: Typecheck[\s\S]*NODE_OPTIONS: "--max-old-space-size=6144"[\s\S]*run: npx tsc --noEmit/,
    );
    // Six: the fifth is the budget sweep and the sixth is the interleaved A/B
    // that runs after it on a red run, which builds the merge base and so needs
    // the same heap as any other production build in this workflow.
    expect(workflow.match(/NODE_OPTIONS: "--max-old-space-size=6144"/g)).toHaveLength(6);
  });

  it("gates coverage and freshness independently", () => {
    expect(workflow).toMatch(/coverage:[\s\S]*name: Coverage[\s\S]*run: >-[\s\S]*npm run coverage/);
    // The clusterless jobs exclude exactly the closed list in
    // scripts/rls/postgresSuites.mjs, never a `*Migration*` glob: that glob
    // both dropped source-text migration tests nobody needed to skip AND let
    // three new `*MigrationEffective` proofs run in a job with no PostgreSQL,
    // where they printed a skip banner and left the job green.
    // __tests__/postgresSuiteInventory.test.ts holds the two lists together.
    expect(workflow).toMatch(
      /coverage:[\s\S]*PUBMAX_RLS_NO_PG: "1"[\s\S]*--exclude '__tests__\/permissionMatrixEffective\.test\.ts'/,
    );
    expect(workflow).not.toMatch(/--exclude '__tests__\/\*\*\/\*Migration\.test\.ts'/);
    expect(workflow).toMatch(
      /freshness:[\s\S]*name: Freshness release gate[\s\S]*npm run check:freshness -- --artifacts-only[\s\S]*node scripts\/check-production-store-freshness\.mjs/,
    );
  });
});
