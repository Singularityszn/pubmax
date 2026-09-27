import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("browser CI policy", () => {
  const workflowPath = join(process.cwd(), ".github", "workflows", "e2e.yml");

  it("runs a bounded law-pinning browser suite on pull requests and main", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toContain("e2e/smoke.spec.ts");
    expect(workflow).toContain("e2e/map-surface-history.spec.ts");
    expect(workflow).toContain("e2e/mobile-map-chrome-fit.spec.ts");
    expect(workflow).toContain("--project=chromium");
  });

  it("keeps the exhaustive browser matrix on nightly and manual runs", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/schedule:/);
    expect(workflow).toMatch(/push:\n\s+branches: \[main\]/);
    expect(workflow).toContain("shard: [1, 2]");
    expect(workflow).toContain("--shard=${{ matrix.shard }}/2");
    expect(workflow).toContain("uses: ./.github/actions/pubmax-mac-playwright");
    expect(workflow).toContain("uses: ./.github/actions/pubmax-playwright-port");
    // P0-3: the three trusted-handoff rollout flags are retired, so there is no
    // second suite whose behaviour a deployment lacks.
    expect(workflow).not.toContain("flag-on");
    expect(workflow).not.toContain("PUBMAX_TONIGHT_GROUPING");
    expect(workflow).not.toContain("PUBMAX_MAP_ROUTE_TRANSFER");
    expect(workflow).not.toContain("PUBMAX_PAL_HANDOFF");

    const fullSuite = workflow.slice(workflow.indexOf("  full-suite:"));
    expect(fullSuite).toContain(
      "if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );

    const lawPins = workflow.slice(
      workflow.indexOf("  law-pins:"),
      workflow.indexOf("  full-suite:"),
    );
    expect(lawPins).not.toContain("if: github.event_name");
  });

  it("gives each production browser build enough heap", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow.match(/NODE_OPTIONS: "--max-old-space-size=6144"/g)).toHaveLength(2);
  });
});
