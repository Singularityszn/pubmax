import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { browserJobExpression } from "./githubExpressions.ts";
import { REQUIRED_CHECKS, releasePolicy } from "./workflow-release-policy.mjs";
import { runnerPolicy } from "./workflow-runner-policy.mjs";
import { browserPolicy } from "./workflow-browser-policy.mjs";
import { scopePolicy } from "./workflow-scope-policy.mjs";
import { commandPolicy } from "./workflow-command-policy.mjs";
import { opsPolicy } from "./workflow-ops-policy.mjs";

const OWN_RUN_GROUP = "${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}";
const REQUIRED = Object.keys(REQUIRED_CHECKS);
const BROWSER_JOBS = [
  "e2e.yml / full-suite", "e2e.yml / full-suite-gl", "e2e.yml / law-pins",
  "e2e.yml / layout-pins-1", "e2e.yml / layout-pins-2", "e2e.yml / layout-pins-3",
  "performance.yml / performance-budget", "performance.yml / ux-lane-performance", "prod-smoke.yml / smoke",
];

export function lintWorkflows(workflows, actions = []) {
  const findings = [];
  const check = (where, policy, inspect) => {
    try {
      inspect();
    } catch (error) {
      findings.push(`${where}: ${policy}: ${error.message}`);
    }
  };
  for (const file of ["events-refresh.yml", "weekly-digest.yml", "uptime.yml", "tavily-london-nightly.yml"]) {
    check(file, "policy workflow exists", () => assert(workflows.some((workflow) => workflow.file === file)));
  }
  const browserJobs = [];
  for (const { file, parsed } of workflows) {
    check(file, "workflow has jobs and triggers", () => {
      assert(parsed && typeof parsed === "object");
      assert(parsed.jobs && typeof parsed.jobs === "object");
      assert(parsed.on);
    });
    if (!parsed?.jobs || !parsed.on) continue;
    const triggers = typeof parsed.on === "string" ? [parsed.on] : Object.keys(parsed.on);
    check(file, "runner concurrency", () => {
      assert(!String(parsed.concurrency?.group ?? "").includes("pubmax-mac"));
      assert.equal(parsed.concurrency?.queue, undefined);
    });
    if (triggers.includes("pull_request") && file !== "e2e.yml") {
      check(file, "pull requests only replace their own older heads", () => {
        assert.deepEqual(parsed.concurrency, {
          group: OWN_RUN_GROUP,
          "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
        });
      });
    }
    if (REQUIRED.includes(file)) {
      check(file, "required checks run for pull requests and merge groups", () => {
        assert(triggers.includes("pull_request"));
        assert(triggers.includes("merge_group"));
      });
    }
    for (const [id, job] of Object.entries(parsed.jobs)) {
      const where = `${file} / ${id}`;
      if ((job.steps ?? []).some((step) => /\bplaywright test\b/.test(step.run ?? ""))) {
        browserJobs.push(where);
        check(where, "browser jobs do not share a concurrency group", () => assert.equal(job.concurrency, undefined));
      }
    }
    if (file === "events-refresh.yml") {
      check(file, "build venue details before refreshing events", () => {
        const runs = Object.values(parsed.jobs).flatMap((job) => (job.steps ?? []).flatMap((step) => (step.run ?? "").split("\n")));
        const build = runs.findIndex((run) => run.trim() === "npm run build:slim");
        const refresh = runs.findIndex((run) => run.includes("npm run refresh:events -- --with-common --open-pr"));
        assert(build >= 0);
        assert(refresh > build);
      });
      check(file, "serialize writes to the stable review branch", () => {
        assert.equal(parsed.concurrency?.group, "whats-on-events-london");
        assert.equal(parsed.concurrency?.["cancel-in-progress"], false);
      });
    }
    if (file === "e2e.yml") {
      check(file, "Browser tests starts on main pushes only", () => assert.deepEqual(parsed.on.push, { branches: ["main"] }));
      check(file, "browser runs replace only the intended waiting run", () => {
        for (const [context, expectedGroup, cancel] of [
          [{ event: "pull_request" }, "pr-7", true],
          [{ event: "pull_request", action: "labeled", label: "layout-pins" }, "pr-7", true],
          [{ event: "pull_request", action: "labeled", label: "needs-triage" }, "run-123", false],
          [{ event: "push" }, "main-push", false],
          [{ event: "merge_group" }, "run-123", false],
          [{ event: "workflow_dispatch" }, "run-123", false],
        ]) {
          const group = (runId) => String(parsed.concurrency?.group ?? "").replace(/\$\{\{([\s\S]*?)\}\}/g,
            (expression) => String(browserJobExpression(expression, { ...context, runId })));
          assert.equal(group(123), `Browser tests-${expectedGroup}`);
          assert.equal(browserJobExpression(String(parsed.concurrency?.["cancel-in-progress"]), context), cancel);
          if (expectedGroup === "run-123") assert.equal(group(124), "Browser tests-run-124");
        }
      });
    }
  }
  check(".github/workflows", "browser job inventory", () => assert.deepEqual(browserJobs.sort(), [...BROWSER_JOBS].sort()));
  check(".github/workflows", "pull request workflow inventory", () => {
    const actual = workflows.filter(({ parsed }) =>
      (typeof parsed?.on === "string" ? [parsed.on] : Object.keys(parsed?.on ?? {})).includes("pull_request"));
    assert.deepEqual(actual.map(({ file }) => file).sort(), [...REQUIRED].sort());
  });
  releasePolicy(workflows, check);
  runnerPolicy(workflows, actions, check);
  browserPolicy(workflows, check);
  scopePolicy(workflows, check);
  commandPolicy(workflows, check);
  opsPolicy(workflows, check);
  return findings;
}

export function readWorkflows(root) {
  return readdirSync(join(root, ".github/workflows"))
    .filter((file) => /\.ya?ml$/.test(file)).sort()
    .map((file) => {
      const source = readFileSync(join(root, ".github/workflows", file), "utf8");
      return { file, source, parsed: parse(source) };
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const actions = readdirSync(join(root, ".github/actions")).map((dir) => ({
    file: `${dir}/action.yml`,
    parsed: parse(readFileSync(join(root, ".github/actions", dir, "action.yml"), "utf8")),
  }));
  const findings = lintWorkflows(readWorkflows(root), actions);
  if (findings.length) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Workflow lint passed.");
  }
}
