import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("browser CI policy", () => {
  const workflowPath = join(process.cwd(), ".github", "workflows", "e2e.yml");

  it("runs a bounded law-pinning browser suite on pull requests", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toContain("e2e/smoke.spec.ts");
    expect(workflow).toContain("e2e/map-surface-history.spec.ts");
    expect(workflow).toContain("e2e/mobile-map-chrome-fit.spec.ts");
    expect(workflow).toContain("--project=chromium");
  });

  it("runs the full browser matrix on pull requests and main pushes", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/schedule:/);
    expect(workflow).toMatch(/push:\n\s+branches: \[main\]/);
    expect(workflow).toContain("suite: [default, flag-on]");
    expect(workflow).toContain("shard: [1, 2, 3, 4]");
    expect(workflow).toContain("--shard=${{ matrix.shard }}/4");
    expect(workflow).toContain("--project=chromium-flag-on");
    expect(workflow).toContain('PUBMAX_TONIGHT_GROUPING: "1"');
    expect(workflow).toContain('PUBMAX_FRIEND_MEMBER_REHYDRATION_V2: "1"');
    expect(workflow).toContain("npx playwright install --with-deps chromium");

    const fullSuite = workflow.slice(workflow.indexOf("  full-suite:"));
    expect(fullSuite).not.toContain("if: github.event_name != 'pull_request'");
  });

  it("gives each production browser build enough heap", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow.match(/NODE_OPTIONS: "--max-old-space-size=6144"/g)).toHaveLength(3);
  });
});
