import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { browserJobCondition, browserJobName } from "./githubExpressions.ts";

const LAYOUT = ["layout-pins-1", "layout-pins-2", "layout-pins-3"];
const FULL = ["full-suite", "full-suite-gl"];
const NAMES = {
  "queue-proof": "Merge queue proof", "law-pins": "Browser law pins", "change-scope": "Change scope",
  "e2e-build": "Build the browser servers", "layout-pins-1": "Browser layout pins (1/3)",
  "layout-pins-2": "Browser layout pins (2/3)", "layout-pins-3": "Browser layout pins (3/3)",
  check: "Browser tests check", "full-suite": "Full browser suite (1/8)",
  "full-suite-gl": "Full browser suite (WebGL and keyless)", "nightly-failure-issue": "Report a nightly full-suite failure",
};

export function browserPolicy(workflows, check) {
  const workflow = workflows.find(({ file }) => file === "e2e.yml")?.parsed;
  if (!workflow?.jobs) return;
  const { jobs } = workflow;
  check("e2e.yml", "browser workflow shape and retired flags", () => {
    assert.deepEqual(Object.keys(jobs), ["queue-proof", "law-pins", "change-scope", "e2e-build", ...LAYOUT, "check", ...FULL, "nightly-failure-issue"]);
    assert(!Object.hasOwn(workflow.on, "schedule"));
    assert(Object.hasOwn(workflow.on, "workflow_dispatch"));
    assert(Object.hasOwn(workflow.on, "pull_request"));
    assert.deepEqual(workflow.on.pull_request, { types: ["opened", "synchronize", "reopened", "labeled"] });
    const envs = [workflow.env, ...Object.values(jobs).flatMap((job) => [job.env, ...job.steps.map((entry) => entry.env)])];
    for (const env of envs) for (const flag of ["TONIGHT_GROUPING", "MAP_ROUTE_TRANSFER", "PAL_HANDOFF"].map((name) => `PUBMAX_${name}`)) assert(!Object.hasOwn(env ?? {}, flag));
    assert.deepEqual(jobs["full-suite"].strategy?.matrix?.shard, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(browserJobName(jobs["full-suite"].name), "Full browser suite (1/8)");
    assert.equal(browserJobCondition(jobs["law-pins"].if), true);
  });
  check("e2e.yml", "unrelated labels skip jobs under distinct check names", () => {
    const context = { action: "labeled", label: "needs-triage", labels: ["layout-pins", "needs-triage"], results: ["failure"] };
    for (const [id, job] of Object.entries(jobs)) {
      assert.equal(browserJobCondition(job.if, context), false, id);
      assert.equal(browserJobName(job.name), NAMES[id], id);
      assert.equal(browserJobName(job.name, context), `Not run for label - ${NAMES[id]}`, id);
      assert.equal(browserJobName(job.name, { ...context, label: "layout-pins" }), NAMES[id], id);
      for (const event of ["push", "merge_group", "workflow_dispatch"]) assert.equal(browserJobName(job.name, { event }), NAMES[id], id);
    }
  });
  check("e2e.yml", "nightly builds are shared only with dependent browser jobs", () => {
    for (const id of ["e2e-build", ...FULL]) {
      for (const event of ["pull_request", "push", "merge_group"]) assert.equal(browserJobCondition(jobs[id].if, { event }), false, id);
      assert.equal(browserJobCondition(jobs[id].if, { event: "workflow_dispatch" }), true, id);
    }
    for (const id of FULL) assert.deepEqual(jobs[id].needs, ["e2e-build"]);
    for (const id of [...FULL, ...LAYOUT]) {
      const prebuilt = jobs[id].steps.find((entry) => entry.uses === "./.github/actions/pubmax-e2e-prebuilt");
      assert(prebuilt, id);
      assert.equal(prebuilt.with?.enabled, "${{ needs.e2e-build.result == 'success' }}", id);
      assert.equal(prebuilt.with?.keyless, id === "full-suite-gl" ? "true" : undefined, id);
    }
  });
  check("e2e.yml", "layout jobs have fixed names and one shared unconditional step list", () => {
    for (const [index, id] of LAYOUT.entries()) {
      assert.equal(browserJobName(jobs[id].name), `Browser layout pins (${index + 1}/3)`);
      assert.equal(jobs[id].strategy, undefined);
      assert.equal(jobs[id].env?.LAYOUT_SHARD, index + 1);
      assert.equal(jobs[id]["runs-on"], "pubmax-mac");
      assert.deepEqual(jobs[id].needs, ["change-scope", "e2e-build"]);
      assert.deepEqual(jobs[id].steps, jobs[LAYOUT[0]].steps);
      for (const entry of jobs[id].steps) assert.equal(entry.if, undefined);
    }
    const scope = jobs["change-scope"];
    assert.equal(scope["runs-on"], "ubuntu-latest");
    assert.deepEqual(scope.steps.map((entry) => entry.name), ["Checkout", "Classify the change", "Classify the layout change"]);
    assert.deepEqual(scope.outputs, { scope: "${{ steps.scope.outputs.scope }}", layout: "${{ steps.layout.outputs.layout }}" });
  });
  for (const id of LAYOUT) check(`e2e.yml / ${id}`, "layout eligibility", () => {
    for (const [context, expected] of [
      [{ event: "pull_request", fork: false, result: "success", layout: "ui" }, false],
      [{ event: "pull_request", result: "failure", layout: "" }, false],
      [{ event: "pull_request", labels: ["needs-triage"] }, false],
      [{ event: "pull_request", labels: ["layout-pins"], result: "success", layout: "ui" }, true],
      [{ event: "pull_request", labels: ["layout-pins"], fork: true, result: "success", layout: "ui" }, false],
      [{ event: "pull_request", labels: ["layout-pins"], result: "success", layout: "non-ui" }, false],
      [{ event: "pull_request", labels: ["layout-pins"], result: "failure", layout: "non-ui" }, true],
      [{ event: "pull_request", labels: ["layout-pins"], fork: true, result: "failure", layout: "non-ui" }, false],
      [{ event: "pull_request", labels: ["layout-pins"], result: "cancelled", layout: "" }, true],
      [{ event: "pull_request", labels: ["layout-pins"], result: "skipped", layout: "" }, true],
      [{ event: "pull_request", labels: ["layout-pins"], cancelled: true }, false],
      [{ event: "pull_request", action: "labeled", label: "needs-triage", labels: ["layout-pins", "needs-triage"] }, false],
      [{ event: "pull_request", action: "labeled", label: "layout-pins", labels: ["layout-pins"] }, true],
      [{ event: "merge_group" }, false], [{ event: "merge_group", result: "failure", layout: "" }, false],
      [{ event: "merge_group", cancelled: true }, false], [{ event: "push" }, false],
      [{ event: "push", result: "failure", layout: "" }, false],
      [{ event: "workflow_dispatch" }, true], [{ event: "workflow_dispatch", result: "failure" }, true],
    ]) assert.equal(browserJobCondition(jobs[id].if, context), expected, JSON.stringify(context));
  });
  check("e2e.yml / nightly-failure-issue", "reporting uses only the run token and issue permission", () => {
    const job = jobs["nightly-failure-issue"];
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.deepEqual(job.needs, ["e2e-build", ...FULL]);
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.deepEqual(job.permissions, { issues: "write" });
    assert.equal(job.steps.length, 1);
    assert.deepEqual(job.steps.map((entry) => entry.uses).filter(Boolean), []);
    assert.deepEqual(job.steps[0].env, {
      GH_TOKEN: "${{ github.token }}", GH_REPO: "${{ github.repository }}",
      RUN_URL: "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}", HEAD_SHA: "${{ github.sha }}",
      BUILD_RESULT: "${{ needs.e2e-build.result }}", SHARDS_RESULT: "${{ needs.full-suite.result }}", GL_RESULT: "${{ needs.full-suite-gl.result }}",
    });
  });
  check("e2e.yml / nightly-failure-issue", "only a failed or cancelled nightly on main creates an issue", () => {
    const expression = jobs["nightly-failure-issue"].if.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").replaceAll("needs.*.result", "needResults");
    for (const event of ["workflow_dispatch", "push", "pull_request", "merge_group"]) {
      for (const ref of ["refs/heads/main", "refs/heads/feature"]) {
        for (const build of ["success", "failure", "cancelled", "skipped"]) {
          for (const shards of ["success", "failure", "cancelled", "skipped"]) {
            for (const gl of ["success", "failure", "cancelled", "skipped"]) {
              const needResults = [build, shards, gl];
              const success = () => needResults.every((result) => result === "success");
              const actual = (/\b(always|success|failure|cancelled)\s*\(/.test(expression) || success()) && Boolean(runInNewContext(`(${expression})`, {
                github: { event_name: event, ref, event: { action: "synchronize", label: { name: "" } } },
                needs: { "e2e-build": { result: build }, "full-suite": { result: shards }, "full-suite-gl": { result: gl } },
                needResults, always: () => true, success, failure: () => needResults.includes("failure"),
                cancelled: () => needResults.includes("cancelled"), contains: (values, value) => values.includes(value),
              }, { timeout: 1000 }));
              assert.equal(actual, event === "workflow_dispatch" && ref === "refs/heads/main" && needResults.some((result) => ["failure", "cancelled"].includes(result)));
            }
          }
        }
      }
    }
  });
}
