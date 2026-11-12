import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { defined } from "@/__tests__/helpers/defined";
import { browserJobCondition, browserJobName } from "@/__tests__/helpers/browserJobCondition";

type WorkflowStep = {
  name?: string;
  id?: string;
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

type CommandCall = { command: string; args: string[]; env: Record<string, string> };

const MERGE_GROUP_CONTEXT = {
  event_name: "merge_group",
  event: { merge_group: { head_ref: "refs/heads/gh-readonly-queue/main/pr-1-abc123" } },
  repository: "Singularityszn/pubmax",
};

function recordBrowserJob(job: WorkflowJob): CommandCall[] {
  const directory = mkdtempSync(join(process.cwd(), ".browser-command-test-"));
  const log = join(directory, "commands.jsonl");
  const output = join(directory, "output");
  const outputs: Record<string, { outputs: Record<string, string> }> = {};
  const evaluate = (expression: string) => runInNewContext(
    `(${expression.replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1")})`,
    { env: job.env ?? {}, matrix: { shard: 1 }, github: MERGE_GROUP_CONTEXT, steps: outputs },
    { timeout: 1000 },
  );
  const interpolate = (value: string) => value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression: string) => String(evaluate(expression)));
  try {
    writeFileSync(log, "");
    for (const command of ["npx", "node", "npm"]) {
      const path = join(directory, command);
      writeFileSync(path, `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (${JSON.stringify(command)} === "node" && args[0] === "scripts/ci/layout-pin-shard.mjs") {
  const result = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(join(process.cwd(), "scripts/ci/layout-pin-shard.mjs"))}, ...args.slice(1)], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
if (${JSON.stringify(command)} === "node" && args[0] !== "scripts/assert-playwright-gate.mjs") process.exit(1);
const env = Object.fromEntries(["PLAYWRIGHT_JSON_OUTPUT_NAME", "NODE_OPTIONS", "PW_SKIP_KEYLESS_WEBSERVER", "PUBMAX_CI_SKIP_BUILD_TYPECHECK"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ command: ${JSON.stringify(command)}, args, env }) + "\\n");
`);
      chmodSync(path, 0o755);
    }
    writeFileSync(join(directory, "git"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(directory, "git"), 0o755);
    for (const step of job.steps) {
      if (step.if && !evaluate(step.if)) continue;
      if (step.uses) {
        writeFileSync(log, JSON.stringify({ command: "action", args: [step.uses], env: {} }) + "\n", { flag: "a" });
      }
      if (!step.run) continue;
      writeFileSync(output, "");
      const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", interpolate(step.run)], {
        cwd: directory,
        env: {
          NODE_ENV: "test",
          PATH: `${directory}:${process.env.PATH}`,
          COMMAND_LOG: log,
          GITHUB_OUTPUT: output,
          ...Object.fromEntries(Object.entries(job.env ?? {}).map(([key, value]) => [key, String(value)])),
          ...Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, interpolate(value)])),
        },
        encoding: "utf8",
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      if (step.id) {
        outputs[step.id] = { outputs: Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        })) };
      }
    }
    return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as CommandCall);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function playwrightCalls(calls: CommandCall[]): CommandCall[] {
  return calls.filter((call) => call.command === "npx" && call.args[0] === "playwright" && call.args[1] === "test");
}

describe("browser CI policy", () => {
  const workflowPath = join(process.cwd(), ".github", "workflows", "e2e.yml");
  const recordings = new Map<string, CommandCall[]>();
  function callsFor(id: string): CommandCall[] {
    if (!recordings.has(id)) {
      const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
      recordings.set(id, recordBrowserJob(defined(jobs[id], id)));
    }
    return defined(recordings.get(id));
  }

  it("records only commands reached by the shell and step conditions", ({ onTestFinished }) => {
    onTestFinished(() => { vi.unstubAllEnvs(); });
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=2048");
    vi.stubEnv("PLAYWRIGHT_JSON_OUTPUT_NAME", "ambient-report.json");
    vi.stubEnv("PW_SKIP_KEYLESS_WEBSERVER", "1");
    vi.stubEnv("PUBMAX_CI_SKIP_BUILD_TYPECHECK", "1");
    const calls = recordBrowserJob({ steps: [
      { if: "false", run: "npx playwright install --with-deps chromium" },
      { run: `
        if false; then
          npx playwright install --with-deps chromium
          npx playwright test e2e/missing.spec.ts --project=chromium-gl
          node scripts/assert-playwright-gate.mjs unused.json
        fi
        npx playwright test e2e/smoke.spec.ts --project=chromium
      ` },
    ] });
    expect(calls).toEqual([{
      command: "npx", args: ["playwright", "test", "e2e/smoke.spec.ts", "--project=chromium"], env: {},
    }]);
  });

  it("runs a bounded law-pinning browser suite on pull requests and main", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    expect(Object.keys(workflow.on)).toContain("pull_request");
    const lawPinsJob = defined(workflow.jobs["law-pins"]);
    expect(browserJobCondition(lawPinsJob.if)).toBe(true);
    const [test, ...extraTestCalls] = playwrightCalls(callsFor("law-pins"));
    expect(extraTestCalls).toEqual([]);
    const run = defined(test, "law-pins Playwright call").args;
    for (const spec of [
      "e2e/smoke.spec.ts",
      "e2e/map-surface-history.spec.ts",
      "e2e/ux-click-recovery.spec.ts",
      "e2e/one-good-night-recovery.spec.ts",
      "e2e/seo-audit-discovery.spec.ts",
    ]) {
      expect(run).toContain(spec);
    }
    expect(run.filter((arg) => arg.startsWith("--project="))).toEqual(["--project=chromium"]);
    expect(test?.env.PLAYWRIGHT_JSON_OUTPUT_NAME).toBe("playwright-law-pins.json");
    const calls = callsFor("law-pins");
    const gates = calls.filter((call) => call.command === "node");
    expect(gates.map((gate) => gate.args)).toEqual([[
      "scripts/assert-playwright-gate.mjs", "playwright-law-pins.json",
      "--require-zero-skipped", "--skips-argued", "e2e/conditional-skips.allowlist.json",
    ]]);
    expect(calls.indexOf(defined(gates[0]))).toBeGreaterThan(calls.indexOf(defined(test)));
  });

  it.each([
    { event: "pull_request", fork: false, expected: false },
    { event: "pull_request", fork: true, expected: false },
    { event: "push", expected: false },
    { event: "merge_group", expected: false },
    { event: "workflow_dispatch", expected: true },
  ] as const)("applies full-suite eligibility to $event ($expected)", ({ expected, ...context }) => {
    const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
    for (const id of FULL_SUITE_JOBS) {
      expect(browserJobCondition(defined(jobs[id], id).if, context), id).toBe(expected);
    }
  });

  it("keeps the exhaustive browser matrix on nightly and manual runs", () => {
    const workflow = parse(readFileSync(workflowPath, "utf8")) as Workflow;

    // GitHub started the schedule hours late, in the working day. The Mac
    // Studio's launchd timer dispatches the nightly on main instead.
    expect(Object.keys(workflow.on)).not.toContain("schedule");
    expect(Object.keys(workflow.on)).toContain("workflow_dispatch");
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    const fullSuiteJob = defined(workflow.jobs["full-suite"], "full-suite job");
    const shards = fullSuiteJob.strategy?.matrix?.shard;
    expect(shards).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(browserJobName(fullSuiteJob.name)).toBe(`Full browser suite (1/${shards?.length})`);
    const [shardCall, ...extraShardCalls] = playwrightCalls(callsFor("full-suite"));
    expect(extraShardCalls).toEqual([]);
    const shardRun = defined(shardCall, "full-suite Playwright call").args;
    expect(shardRun.filter((word) => word.startsWith("--shard="))).toEqual([
      `--shard=1/${shards?.length}`,
    ]);
    // The Chromium shards build one server; only the keyless project needs two.
    expect(shardCall?.env?.PW_SKIP_KEYLESS_WEBSERVER).toBe("1");

    // Between them the two jobs run every project the nightly always ran, and
    // each project once.
    const [glCall, ...extraGlCalls] = playwrightCalls(callsFor("full-suite-gl"));
    expect(extraGlCalls).toEqual([]);
    const glRun = defined(glCall, "full-suite-gl Playwright call").args;
    expect(glRun.filter((word) => word.startsWith("--shard="))).toEqual([]);
    expect(glCall?.env?.PW_SKIP_KEYLESS_WEBSERVER).toBeUndefined();
    const projects = (run: string[]) =>
      run.filter((word) => word.startsWith("--project=")).map((word) => word.slice("--project=".length));
    expect(projects(shardRun)).toEqual(["chromium"]);
    expect(projects(glRun).sort()).toEqual([
      "chromium-gl",
      "chromium-keyless",
      "chromium-no-gl",
      "chromium-sw-gl",
    ]);
    for (const [id, call] of [["full-suite", shardCall], ["full-suite-gl", glCall]] as const) {
      const report = defined(call?.env.PLAYWRIGHT_JSON_OUTPUT_NAME, "JSON report name");
      const gates = callsFor(id).filter((entry) => entry.command === "node");
      expect(gates.map((gate) => gate.args)).toEqual([["scripts/assert-playwright-gate.mjs", report]]);
      expect(callsFor(id).indexOf(defined(gates[0]))).toBeGreaterThan(callsFor(id).indexOf(defined(call)));
    }
    // Both jobs leave out the same known-red tests, each under its issue.
    expect(shardRun).toContain("--test-list-invert=e2e/full-suite-quarantine.txt");
    expect(glRun).toContain("--test-list-invert=e2e/full-suite-quarantine.txt");
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

  it.each([
    { event: "workflow_dispatch", ref: "refs/heads/main", nightly: true },
    { event: "workflow_dispatch", ref: "refs/heads/fm/branch-check", nightly: false },
    { event: "push", ref: "refs/heads/main", nightly: false },
    { event: "pull_request", ref: "refs/pull/1/merge", nightly: false },
    { event: "merge_group", ref: "refs/heads/gh-readonly-queue/main/pr-1", nightly: false },
  ])(
    "reports failures or cancellations only for the nightly ($event on $ref)",
    ({ event, ref, nightly }) => {
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
      for (const [shards, gl, reportOnNightly] of outcomes) {
        const needResults = [shards, gl];
        const success = () => needResults.every((result) => result === "success");
        const hasStatusFunction = /\b(always|success|failure|cancelled)\s*\(/.test(expression);
        const actual = (hasStatusFunction || success()) && Boolean(runInNewContext(`(${expression})`, {
          github: { event_name: event, ref, event: { action: "synchronize", label: { name: "" } } },
          needs: { "full-suite": { result: shards }, "full-suite-gl": { result: gl } },
          needResults,
          always: () => true,
          success,
          failure: () => needResults.includes("failure"),
          cancelled: () => needResults.includes("cancelled"),
          contains: (values: string[], value: string) => values.includes(value),
        }, { timeout: 1000 }));
        expect(actual, `${event}: full-suite=${shards}, full-suite-gl=${gl}`)
          .toBe(nightly && reportOnNightly);
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
        "The nightly full browser suite did not pass.",
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
    const executedSpecs: string[] = [];
    for (const id of LAYOUT_PIN_JOBS) {
      const shard = String(defined(jobs[id]).env?.LAYOUT_SHARD);
      const calls = callsFor(id);
      const tests = playwrightCalls(calls);
      expect(tests).toHaveLength(1);
      const test = defined(tests[0]);
      const specs = test.args.filter((arg) => arg.startsWith("e2e/"));
      expect(specs.length).toBeGreaterThan(0);
      executedSpecs.push(...specs);
      expect(test.args.filter((arg) => arg.startsWith("--project="))).toEqual([
        "--project=chromium", "--project=chromium-gl", "--project=chromium-no-gl",
      ]);
      expect(test.args).toContain("--reporter=list,json");
      expect(test.env.PLAYWRIGHT_JSON_OUTPUT_NAME).toBe(`playwright-layout-pins-${shard}.json`);
      const gates = calls.filter((call) => call.command === "node");
      expect(gates.map((gate) => gate.args)).toEqual([[
        "scripts/assert-playwright-gate.mjs", test.env.PLAYWRIGHT_JSON_OUTPUT_NAME,
        "--require-zero-skipped", "--skips-argued", "e2e/conditional-skips.allowlist.json",
      ]]);
      expect(calls.indexOf(defined(gates[0]))).toBeGreaterThan(calls.indexOf(test));
    }
    for (const spec of requiredSpecs) expect(executedSpecs.filter((file) => file === spec), spec).toHaveLength(1);
  });

  describe("a layout pin for a merge group that is gone", () => {
    function layoutSteps() {
      const { jobs } = parse(readFileSync(workflowPath, "utf8")) as Workflow;
      return defined(jobs["layout-pins-1"]).steps;
    }
    function gate() {
      return defined(layoutSteps().find((step) => step.name === "Stop when the merge group is gone"), "merge group gate");
    }

    function runGate(queueRef: string, gitExit: number) {
      const directory = mkdtempSync(join(process.cwd(), ".merge-group-gate-test-"));
      try {
        const calls = join(directory, "calls");
        writeFileSync(calls, "");
        writeFileSync(join(directory, "git"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${calls}"\nexit ${gitExit}\n`);
        chmodSync(join(directory, "git"), 0o755);
        const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", defined(gate().run)], {
          env: {
            NODE_ENV: "test",
            PATH: `${directory}:${process.env.PATH}`,
            REPO: "Singularityszn/pubmax",
            QUEUE_REF: queueRef,
          },
          encoding: "utf8",
        });
        return { result, calls: readFileSync(calls, "utf8").trim() };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }

    it("checks the group before the job checks out or installs anything", () => {
      expect(layoutSteps()[0]).toEqual(gate());
    });

    it.each([
      { case: "the group is live", gitExit: 0, exit: 0, annotation: "" },
      { case: "the group is gone", gitExit: 2, exit: 1, annotation: "::error::" },
      { case: "GitHub cannot be reached", gitExit: 128, exit: 0, annotation: "::warning::" },
    ])("stops only when $case says so", ({ gitExit, exit, annotation }) => {
      const queueRef = "refs/heads/gh-readonly-queue/main/pr-1-abc123";
      const { result, calls } = runGate(queueRef, gitExit);
      expect(result.status, result.stderr).toBe(exit);
      if (annotation) expect(result.stdout).toContain(annotation);
      else expect(result.stdout).not.toMatch(/::(?:error|warning)::/);
      expect(calls.split("\n")).toEqual([
        "ls-remote", "--exit-code", "https://github.com/Singularityszn/pubmax", queueRef,
      ]);
    });

    it("runs a pull request's layout pins without asking for a group", () => {
      const { result, calls } = runGate("", 2);
      expect(result.status, result.stderr).toBe(0);
      expect(calls).toBe("");
    });
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
    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS]) {
      const specs = playwrightCalls(callsFor(jobName)).flatMap((call) =>
        call.args.filter((arg) => arg.startsWith("e2e/")),
      );
      expect(specs.length, jobName).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(existsSync(join(process.cwd(), spec)), spec).toBe(true);
      }
    }
  });

  it("installs Chromium and chooses a port before every Playwright run", () => {
    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      const calls = callsFor(jobName);
      const install = calls.findIndex((call) => call.command === "npx" &&
        call.args[0] === "playwright" && call.args[1] === "install" &&
        call.args.includes("--with-deps") && call.args.includes("chromium"));
      const port = calls.findIndex((call) => call.command === "action" &&
        call.args[0] === "./.github/actions/pubmax-playwright-port");
      const tests = playwrightCalls(calls);
      expect(install, jobName).toBeGreaterThanOrEqual(0);
      expect(port, jobName).toBeGreaterThanOrEqual(0);
      expect(tests.length, jobName).toBeGreaterThan(0);
      for (const test of tests) {
        expect(calls.indexOf(test), jobName).toBeGreaterThan(install);
        expect(calls.indexOf(test), jobName).toBeGreaterThan(port);
      }
    }
  });

  it("gives each production browser build enough heap", () => {
    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      const calls = playwrightCalls(callsFor(jobName));
      expect(calls.length, jobName).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.env.NODE_OPTIONS, jobName).toBe(
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
    for (const jobName of ["law-pins", ...LAYOUT_PIN_JOBS, ...FULL_SUITE_JOBS]) {
      const calls = playwrightCalls(callsFor(jobName));
      expect(calls.length, jobName).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.env.PUBMAX_CI_SKIP_BUILD_TYPECHECK, jobName).toBe("1");
      }
    }
  });
});
