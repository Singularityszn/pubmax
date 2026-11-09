import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { defined } from "@/__tests__/helpers/defined";
import { browserJobCondition, browserJobName } from "@/__tests__/helpers/browserJobCondition";

type WorkflowStep = {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type WorkflowJob = {
  name?: string;
  if?: string;
  needs?: string[];
  "runs-on"?: string;
  env?: Record<string, string | number>;
  steps: WorkflowStep[];
  strategy?: { matrix?: { shard?: number[] } };
};
type Workflow = {
  on: Record<string, unknown>;
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};

// The layout pins are three named jobs that share one step list, not a matrix.
const LAYOUT_PIN_JOBS = ["layout-pins-1", "layout-pins-2", "layout-pins-3"];
// The nightly full suite: the plain Chromium project in count-cut shards, and
// every other project the default run covers in one job of its own.
const FULL_SUITE_JOBS = ["full-suite", "full-suite-gl"];

// A `${{ ... }}` expression is one word even though it holds spaces.
function runWords(run: string | undefined): string[] {
  return run?.match(/(?:\$\{\{[^}]*\}\}|\S)+/g) ?? [];
}

function playwrightSteps(job: WorkflowJob): WorkflowStep[] {
  return job.steps.filter((step) => step.run?.includes("npx playwright test"));
}

describe("browser CI policy", () => {
  const workflowPath = join(process.cwd(), ".github", "workflows", "e2e.yml");

  it("runs a bounded law-pinning browser suite on pull requests and main", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(Object.keys(workflow.on)).toContain("pull_request");
    const lawPinsJob = defined(workflow.jobs["law-pins"]);
    const [testStep, ...extraTestSteps] = playwrightSteps(lawPinsJob);
    expect(extraTestSteps).toEqual([]);
    const run = runWords(defined(testStep, "law-pins Playwright step").run);
    for (const spec of [
      "e2e/smoke.spec.ts",
      "e2e/map-surface-history.spec.ts",
      "e2e/ux-click-recovery.spec.ts",
      "e2e/one-good-night-recovery.spec.ts",
      "e2e/seo-audit-discovery.spec.ts",
    ]) {
      expect(run).toContain(spec);
    }
    expect(run).toContain("--project=chromium");
  });

  it.each([
    { event: "pull_request", fork: false, expected: false },
    { event: "pull_request", fork: true, expected: false },
    { event: "push", expected: false },
    { event: "merge_group", expected: false },
    { event: "schedule", expected: true },
    { event: "workflow_dispatch", expected: true },
  ] as const)("applies full-suite eligibility to $event ($expected)", ({ expected, ...context }) => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    for (const id of FULL_SUITE_JOBS) {
      expect(browserJobCondition(defined(jobs[id], id).if, context), id).toBe(expected);
    }
  });

  it("keeps the exhaustive browser matrix on nightly and manual runs", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(workflow.on.schedule).toEqual([
      expect.objectContaining({ cron: expect.any(String) }),
    ]);
    expect(Object.keys(workflow.on)).toContain("workflow_dispatch");
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    const fullSuiteJob = defined(workflow.jobs["full-suite"], "full-suite job");
    const glJob = defined(workflow.jobs["full-suite-gl"], "full-suite-gl job");
    const shards = fullSuiteJob.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(browserJobName(fullSuiteJob.name)).toBe(`Full browser suite (1/${shards?.length})`);
    const [shardStep, ...extraShardSteps] = playwrightSteps(fullSuiteJob);
    expect(extraShardSteps).toEqual([]);
    const shardRun = runWords(defined(shardStep, "full-suite Playwright step").run);
    expect(shardRun.filter((word) => word.startsWith("--shard="))).toEqual([
      `--shard=\${{ matrix.shard }}/${shards?.length}`,
    ]);
    // The Chromium shards build one server; only the keyless project needs two.
    expect(shardStep?.env?.PW_SKIP_KEYLESS_WEBSERVER).toBe("1");

    // Between them the two jobs run every project the nightly always ran, and
    // each project once.
    const [glStep, ...extraGlSteps] = playwrightSteps(glJob);
    expect(extraGlSteps).toEqual([]);
    const glRun = runWords(defined(glStep, "full-suite-gl Playwright step").run);
    expect(glRun.filter((word) => word.startsWith("--shard="))).toEqual([]);
    expect(glStep?.env?.PW_SKIP_KEYLESS_WEBSERVER).toBeUndefined();
    const projects = (run: string[]) =>
      run.filter((word) => word.startsWith("--project=")).map((word) => word.slice("--project=".length));
    expect(projects(shardRun)).toEqual(["chromium"]);
    expect(projects(glRun).sort()).toEqual([
      "chromium-gl",
      "chromium-keyless",
      "chromium-no-gl",
      "chromium-sw-gl",
    ]);
    for (const [job, step] of [[fullSuiteJob, shardStep], [glJob, glStep]] as const) {
      const report = defined(step?.env?.PLAYWRIGHT_JSON_OUTPUT_NAME, "JSON report name");
      const gate = runWords(
        job.steps.find((candidate) =>
          runWords(candidate.run).includes("scripts/assert-playwright-gate.mjs"),
        )?.run,
      );
      expect(gate[gate.indexOf("scripts/assert-playwright-gate.mjs") + 1]).toBe(report);
    }
  });

  it("starts the nightly in the evening, so GitHub's usual delay lands it before the working day", () => {
    // GitHub created the 03:17 UTC schedule at 09:40 to 11:11 UTC from 29 Oct
    // to 7 Nov 2026, and the full suite then held the Mac pool all morning.
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    expect(workflow.on.schedule).toEqual([{ cron: "17 20 * * *" }]);
  });

  it("uses the run token and issue permission without a checkout", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow & {
      permissions?: Record<string, string>;
    };
    const job = defined(workflow.jobs["nightly-failure-issue"], "nightly-failure-issue job") as WorkflowJob & {
      permissions?: Record<string, string>;
      "timeout-minutes"?: number;
    };
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(job.needs).toEqual(FULL_SUITE_JOBS);
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.permissions).toEqual({ issues: "write" });
    // No checkout and no repository code: the job only talks to GitHub.
    expect(job.steps.map((step) => step.uses).filter(Boolean)).toEqual([]);
    const [step, ...extra] = job.steps;
    expect(extra).toEqual([]);
    expect(step?.env).toEqual({
      GH_TOKEN: "${{ github.token }}",
      GH_REPO: "${{ github.repository }}",
      RUN_URL: "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
      HEAD_SHA: "${{ github.sha }}",
      SHARDS_RESULT: "${{ needs.full-suite.result }}",
      GL_RESULT: "${{ needs.full-suite-gl.result }}",
    });
  });

  it.each(["schedule", "push", "pull_request", "merge_group", "workflow_dispatch"])(
    "reports only scheduled failures or cancellations for %s",
    (event) => {
      const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
      const expression = defined(jobs["nightly-failure-issue"]?.if)
        .trim()
        .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
        .replaceAll("needs.*.result", "needResults");
      const outcomes = [
        ["success", "success", false],
        ["success", "failure", true],
        ["success", "cancelled", true],
        ["success", "skipped", false],
        ["failure", "success", true],
        ["failure", "failure", true],
        ["failure", "cancelled", true],
        ["failure", "skipped", true],
        ["cancelled", "success", true],
        ["cancelled", "failure", true],
        ["cancelled", "cancelled", true],
        ["cancelled", "skipped", true],
        ["skipped", "success", false],
        ["skipped", "failure", true],
        ["skipped", "cancelled", true],
        ["skipped", "skipped", false],
      ] as const;
      for (const [shards, gl, reportOnSchedule] of outcomes) {
        const needResults = [shards, gl];
        const success = () => needResults.every((result) => result === "success");
        const hasStatusFunction = /\b(always|success|failure|cancelled)\s*\(/.test(expression);
        const actual = (hasStatusFunction || success()) && Boolean(runInNewContext(`(${expression})`, {
          github: { event_name: event, event: { action: "synchronize", label: { name: "" } } },
          needs: { "full-suite": { result: shards }, "full-suite-gl": { result: gl } },
          needResults,
          always: () => true,
          success,
          failure: () => needResults.includes("failure"),
          cancelled: () => needResults.includes("cancelled"),
          contains: (values: string[], value: string) => values.includes(value),
        }, { timeout: 1000 }));
        expect(actual, `${event}: full-suite=${shards}, full-suite-gl=${gl}`)
          .toBe(event === "schedule" && reportOnSchedule);
      }
    },
  );

  it.each([
    {
      scenario: "comments on the exact title after a near match",
      issues: [
        { number: 41, title: "Nightly full browser suite failed yesterday" },
        { number: 42, title: "Nightly full browser suite failed" },
      ],
      issueNumber: "42",
      shards: "failure",
      gl: "success",
    },
    {
      scenario: "creates an issue when none are open",
      issues: [],
      issueNumber: null,
      shards: "success",
      gl: "cancelled",
    },
    {
      scenario: "creates an issue when only a near match is open",
      issues: [{ number: 41, title: "Nightly full browser suite failed yesterday" }],
      issueNumber: null,
      shards: "cancelled",
      gl: "failure",
    },
  ])("$scenario", ({ issues, issueNumber, shards, gl }) => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    const step = defined(defined(jobs["nightly-failure-issue"]).steps[0]);
    const directory = mkdtempSync(join(process.cwd(), ".nightly-issue-test-"));
    try {
      const callsPath = join(directory, "calls.jsonl");
      writeFileSync(callsPath, "");
      writeFileSync(join(directory, "gh"), `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + "\\n");
if (args[0] === "issue" && args[1] === "list") {
  process.stdout.write(process.env.ISSUE_LIST);
} else if (args[0] !== "issue" || !["comment", "create"].includes(args[1])) {
  process.exit(1);
}
`, { mode: 0o755 });
      const run = spawnSync("bash", ["--noprofile", "--norc", "-c", defined(step.run)], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10000,
        env: {
          NODE_ENV: "test",
          PATH: `${directory}:${process.env.PATH}`,
          GH_CALLS: callsPath,
          ISSUE_LIST: JSON.stringify(issues),
          GH_TOKEN: "test-token",
          GH_REPO: "owner/repository",
          RUN_URL: "https://github.example/owner/repository/actions/runs/123",
          HEAD_SHA: "0123456789abcdef",
          SHARDS_RESULT: shards,
          GL_RESULT: gl,
        },
      });
      expect(run.error).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      const title = "Nightly full browser suite failed";
      const body = [
        "The scheduled full browser suite did not pass.",
        "",
        "- Run: https://github.example/owner/repository/actions/runs/123",
        "- Commit: 0123456789abcdef",
        `- Full browser suite (n/8): ${shards}`,
        `- Full browser suite (WebGL and keyless): ${gl}`,
      ].join("\n");
      expect(calls).toEqual([
        ["issue", "list", "--state", "open", "--search", `in:title "${title}"`, "--json", "number,title", "--limit", "20"],
        issueNumber === null
          ? ["issue", "create", "--title", title, "--body", body]
          : ["issue", "comment", issueNumber, "--body", body],
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs no second suite behind a retired rollout flag", () => {
    // P0-3: the three trusted-handoff rollout flags are retired, so there is no
    // second suite whose behaviour a deployment lacks.
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(Object.keys(workflow.jobs)).toEqual([
      "queue-proof",
      "law-pins",
      "change-scope",
      ...LAYOUT_PIN_JOBS,
      "check",
      ...FULL_SUITE_JOBS,
      "nightly-failure-issue",
    ]);
    const envKeys = [
      workflow.env,
      ...Object.values(workflow.jobs).flatMap((job) => [
        job.env,
        ...job.steps.map((step) => step.env),
      ]),
    ].flatMap((env) => Object.keys(env ?? {}));
    for (const flag of [
      "PUBMAX_TONIGHT_GROUPING",
      "PUBMAX_MAP_ROUTE_TRANSFER",
      "PUBMAX_PAL_HANDOFF",
    ]) {
      expect(envKeys).not.toContain(flag);
    }
  });

  it("runs the layout-pinning browser specs in three named shards", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    const layoutJobs = LAYOUT_PIN_JOBS.map((id) => defined(jobs[id], id));
    layoutJobs.forEach((job, index) => {
      // A fixed name, so a job skipped for a docs change still reports under
      // the check name branch protection waits for.
      expect(browserJobName(job.name)).toBe(`Browser layout pins (${index + 1}/3)`);
      expect(job.strategy).toBeUndefined();
      expect(job.env?.LAYOUT_SHARD).toBe(index + 1);
      expect(job.needs).toEqual(["change-scope"]);
      // One step list for all three, so the shards cannot drift apart.
      expect(job.steps).toEqual(defined(layoutJobs[0]).steps);
    });
    const requiredSpecs = [
      "e2e/desktop-map-chrome-fit.spec.ts",
      "e2e/mobile-map-chrome-fit.spec.ts",
      "e2e/mobile-map-shell-matrix.spec.ts",
      "e2e/ui-consistency-layout.spec.ts",
      "e2e/landing-uk-directory.spec.ts",
      "e2e/map-desktop-arrival-chrome.spec.ts",
      "e2e/drink-chip-controls.spec.ts",
      "e2e/desktop-map-large-text.spec.ts",
      "e2e/native-onboarding-actions.spec.ts",
      "e2e/web-first-run-journey.spec.ts",
      "e2e/plan-route-result.spec.ts",
    ];
    const directory = mkdtempSync(join(process.cwd(), ".layout-command-test-"));
    try {
      const log = join(directory, "commands.jsonl");
      for (const command of ["npx", "node"]) {
        const path = join(directory, command);
        writeFileSync(path, `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (${JSON.stringify(command)} === "node" && args[0] !== "scripts/assert-playwright-gate.mjs") {
  const result = spawnSync(${JSON.stringify(process.execPath)}, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ command: ${JSON.stringify(command)}, args, report: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME }) + "\\n");
`);
        chmodSync(path, 0o755);
      }
      const executedSpecs: string[] = [];
      for (const job of layoutJobs) {
        const shard = String(job.env?.LAYOUT_SHARD);
        const interpolate = (text: string) => text.replaceAll("${{ env.LAYOUT_SHARD }}", shard);
        const testStep = defined(job.steps.find((step) => step.name === "Run layout-pinning journeys"));
        const gateStep = defined(job.steps.find((step) => step.name === "Gate the layout-pinning shard"));
        expect(testStep.if).toBeUndefined();
        const env = {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          COMMAND_LOG: log,
          ...Object.fromEntries(Object.entries(testStep.env ?? {}).map(([key, value]) => [key, interpolate(value)])),
        };
        writeFileSync(log, "");
        for (const step of [testStep, gateStep]) {
          const result = spawnSync("bash", ["-e", "-c", interpolate(defined(step.run))], { cwd: process.cwd(), env, encoding: "utf8" });
          expect(result.status, result.stderr).toBe(0);
        }
        const calls = readFileSync(log, "utf8").trim().split("\n").map((line) =>
          JSON.parse(line) as { command: string; args: string[]; report?: string });
        expect(calls).toHaveLength(2);
        const test = defined(calls[0]);
        expect(test.command).toBe("npx");
        expect(test.args.slice(0, 2)).toEqual(["playwright", "test"]);
        const specs = test.args.filter((arg) => arg.startsWith("e2e/"));
        expect(specs.length).toBeGreaterThan(0);
        executedSpecs.push(...specs);
        expect(test.args.filter((arg) => arg.startsWith("--project="))).toEqual([
          "--project=chromium", "--project=chromium-gl", "--project=chromium-no-gl",
        ]);
        expect(test.args).toContain("--reporter=list,json");
        expect(test.report).toBe(`playwright-layout-pins-${shard}.json`);
        expect(calls[1]).toMatchObject({ command: "node", args: [
          "scripts/assert-playwright-gate.mjs", test.report,
          "--require-zero-skipped", "--skips-argued", "e2e/conditional-skips.allowlist.json",
        ] });
      }
      for (const spec of requiredSpecs) expect(executedSpecs.filter((file) => file === spec), spec).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs the same layout steps for every pull request branch", () => {
    // The before/after evidence steps for three October branches were gated
    // on their names. Those pull requests merged, and no step may be kept
    // for one branch again.
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    for (const id of LAYOUT_PIN_JOBS) {
      for (const step of defined(jobs[id]).steps) {
        expect(step.if, `${id} / ${step.name}`).toBeUndefined();
      }
    }
  });

  it("names only spec files that exist in each pull-request browser job", () => {
    // Playwright ORs its file filters, so a renamed spec would drop out silently.
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS]) {
      const specs = playwrightSteps(defined(jobs[jobName])).flatMap((step) =>
        runWords(step.run).filter((word) => word.startsWith("e2e/")),
      );
      expect(specs.length, jobName).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(existsSync(join(process.cwd(), spec)), spec).toBe(true);
      }
    }
  });

  it("installs Chromium and its system dependencies before every Playwright run", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      const steps = defined(jobs[jobName]).steps;
      const install = steps.findIndex((step) =>
        step.run?.split("\n").some((line) => {
          const words = line.trim().split(/\s+/);
          return (
            words.slice(0, 3).join(" ") === "npx playwright install" &&
            words.includes("--with-deps") &&
            words.includes("chromium")
          );
        }),
      );
      const playwrightRuns = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.run?.includes("npx playwright test"));

      expect(install, jobName).toBeGreaterThanOrEqual(0);
      expect(playwrightRuns.length, jobName).toBeGreaterThan(0);
      for (const { index } of playwrightRuns) {
        expect(index, jobName).toBeGreaterThan(install);
      }
    }
  });

  it("chooses a runner-specific Playwright port before every Playwright run", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      const steps = defined(jobs[jobName]).steps;
      const portStep = steps.findIndex(
        (step) => step.uses === "./.github/actions/pubmax-playwright-port",
      );
      const playwrightRuns = steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.run?.includes("npx playwright test"));

      expect(portStep, jobName).toBeGreaterThanOrEqual(0);
      expect(playwrightRuns.length, jobName).toBeGreaterThan(0);
      for (const { index } of playwrightRuns) {
        expect(index, jobName).toBeGreaterThan(portStep);
      }
    }
  });

  it("gives each production browser build enough heap", () => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      const steps = playwrightSteps(defined(jobs[jobName]));
      expect(steps.length, jobName).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.env?.NODE_OPTIONS, jobName).toBe(
          "--max-old-space-size=6144",
        );
      }
    }
  });

  it("skips each browser build's own type check, which the CI TypeScript 6 job already runs wider", () => {
    // next build type-checks with TypeScript 6. The CI Typecheck (TypeScript 6) job
    // runs that compiler over a superset of the files on the same commit, and
    // on a macOS runner the build's copy took over 6 minutes and pushed the
    // Playwright web server past its 10 minute start limit (captain, 2 Nov
    // 2026; docs/CI_RUNBOOK.md, "Build cache and type check").
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      for (const step of playwrightSteps(defined(jobs[jobName]))) {
        expect(step.env?.PUBMAX_CI_SKIP_BUILD_TYPECHECK, jobName).toBe("1");
      }
    }
  });
});
