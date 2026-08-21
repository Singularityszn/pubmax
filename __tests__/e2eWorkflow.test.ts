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

  it("shards the full browser suite on a schedule", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/schedule:/);
    expect(workflow).toContain("shard: [1, 2, 3, 4]");
    expect(workflow).toContain("--shard=${{ matrix.shard }}/4");
    expect(workflow).toContain("npx playwright install --with-deps chromium");
  });
});
