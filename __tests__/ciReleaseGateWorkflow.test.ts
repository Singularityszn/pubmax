import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { ciJobs, jobStep } from "@/__tests__/helpers/ciWorkflow";
import { defined } from "@/__tests__/helpers/defined";

function runStepOutput(run: string, outputVariable: string): Record<string, string> {
  const scratch = mkdtempSync(join(tmpdir(), "pubmax-release-workflow-"));
  const output = join(scratch, "output");
  try {
    writeFileSync(output, "");
    execFileSync("bash", ["-e", "-c", run], {
      env: { ...process.env, [outputVariable]: output },
    });
    return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => {
      const equals = line.indexOf("=");
      return [line.slice(0, equals), line.slice(equals + 1)];
    }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe("clean-main CI release commands", () => {
  it("records the job's start before anything can spend the wall", () => {
    const workflow = parse(readFileSync(join(process.cwd(), ".github/workflows/performance.yml"), "utf8")) as {
      jobs: Record<string, { steps: { run?: string }[] }>;
    };
    const first = defined(workflow.jobs["performance-budget"]?.steps[0]);
    const before = Math.floor(Date.now() / 1000) * 1000;
    const output = runStepOutput(defined(first.run), "GITHUB_ENV");
    const started = Number(output.PUBMAX_PERF_AB_JOB_STARTED_MS);
    expect(started).toBeGreaterThanOrEqual(before);
    expect(started).toBeLessThanOrEqual(Date.now());
  });

  it("names the build cache with the current UTC date", () => {
    const build = defined(ciJobs()["production-build"], "production-build job");
    const day = jobStep(build, "Name the build cache for today");
    const before = new Date().toISOString().slice(0, 10);
    const output = runStepOutput(defined(day.run), "GITHUB_OUTPUT");
    const after = new Date().toISOString().slice(0, 10);
    expect([before, after]).toContain(output.day);
  });

  it("skips the build type check only where a wider check already ran", () => {
    const readJson = (file: string) =>
      JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as {
        extends?: string;
        compilerOptions?: unknown;
        include?: string[];
      };
    const buildConfig = readJson("tsconfig.build.json");
    expect(buildConfig.extends).toBe("./tsconfig.json");
    expect(buildConfig.compilerOptions).toBeUndefined();
    // Compare what TypeScript itself resolves, not the include lists: an
    // exclude added to tsconfig.json alone would otherwise drop app files
    // from the wider check without a word.
    const resolved = (file: string) =>
      JSON.parse(
        execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--showConfig", "-p", file], {
          cwd: process.cwd(),
          encoding: "utf8",
        }),
      ) as { files?: string[]; compilerOptions?: unknown };
    const fullResolved = resolved("tsconfig.json");
    const buildResolved = resolved("tsconfig.build.json");
    const fullFiles = new Set(fullResolved.files ?? []);
    const uncovered = (buildResolved.files ?? []).filter((file) => !fullFiles.has(file));
    expect(buildResolved.files?.length ?? 0).toBeGreaterThan(0);
    expect(uncovered).toEqual([]);
    expect(buildResolved.compilerOptions).toEqual(fullResolved.compilerOptions);

    // A Vercel dashboard variable reaches Vercel builds too, so the skip is
    // refused on Vercel and a deploy build always type-checks.
    for (const [skip, vercel, expected] of [
      ["", "", false],
      ["1", "", true],
      ["", "1", false],
      ["1", "1", false],
    ] as const) {
      const output = execFileSync(process.execPath, ["--input-type=module", "-e",
        'import config from "./next.config.mjs"; console.log(JSON.stringify(config.typescript.ignoreBuildErrors));',
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PUBMAX_CI_SKIP_BUILD_TYPECHECK: skip, VERCEL: vercel },
      });
      expect(JSON.parse(output.trim()), `skip=${skip}, VERCEL=${vercel}`).toBe(expected);
    }
  });
});
