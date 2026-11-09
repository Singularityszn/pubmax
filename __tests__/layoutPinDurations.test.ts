import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function refresh(reports: unknown[]) {
  const root = mkdtempSync(join(process.cwd(), ".layout-duration-test-"));
  try {
    mkdirSync(join(root, "scripts/ci"), { recursive: true });
    const script = join(root, "scripts/ci/update-layout-pin-durations.mjs");
    const output = join(root, "scripts/ci/layout-pin-durations.json");
    copyFileSync("scripts/ci/update-layout-pin-durations.mjs", script);
    writeFileSync(output, JSON.stringify({ files: { "e2e/a.spec.ts": 10, "e2e/b.spec.ts": 20, "e2e/missing.spec.ts": 30 } }));
    const paths = reports.map((report, index) => {
      const path = join(root, `report-${index}.json`);
      writeFileSync(path, JSON.stringify(report));
      return path;
    });
    const result = spawnSync(process.execPath, [script, ...paths], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(readFileSync(output, "utf8")).files;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function suite(file: string, ...durations: number[]) {
  return { file, specs: [{ tests: durations.map((duration) => ({ results: [{ duration }] })) }] };
}

describe("layout duration refresh", () => {
  it("keeps a partial rerun from doubling one shard's cost", () => {
    expect(refresh([
      { suites: [suite("a.spec.ts", 100), suite("b.spec.ts", 200)] },
      { suites: [suite("a.spec.ts", 100)] },
    ])).toEqual({ "e2e/a.spec.ts": 100, "e2e/b.spec.ts": 200, "e2e/missing.spec.ts": 30 });
  });

  it("takes the median of report totals, including nested project results", () => {
    expect(refresh([
      { suites: [{ file: "a.spec.ts", suites: [{ specs: [{ tests: [{ results: [{ duration: 40 }, { duration: 60 }] }] }] }] }, suite("b.spec.ts", 201)] },
      { suites: [suite("a.spec.ts", 200), suite("b.spec.ts", 300), suite("unknown.spec.ts", 5000)] },
      { suites: [suite("a.spec.ts", 900)] },
    ])).toEqual({ "e2e/a.spec.ts": 200, "e2e/b.spec.ts": 251, "e2e/missing.spec.ts": 30 });
  });

  it("counts path aliases once per report and leaves absent specs unchanged", () => {
    expect(refresh([
      { suites: [suite("a.spec.ts", 100), suite("e2e/a.spec.ts", 200)] },
      { suites: [suite("a.spec.ts", 500)] },
      { suites: [] },
    ])).toEqual({ "e2e/a.spec.ts": 400, "e2e/b.spec.ts": 20, "e2e/missing.spec.ts": 30 });
  });
});
