import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

function downloadPolicy(workflows, check) {
  for (const file of ["security-ci.yml", "rls-session.yml"]) check(file, "active pinned installers use verified sources and content-addressed caches", () => {
    const jobs = workflows.find((entry) => entry.file === file).parsed.jobs;
    const installers = Object.values(jobs).flatMap((job) => (job.steps ?? []).flatMap((step, index) => {
      const lines = (step.run ?? "").replace(/\\\n/g, " ").split("\n").map((line) => line.trim());
      return lines.some((line) => line.split(/\s+/)[0] === "scripts/ci/install-pinned-tool.sh") ? [{ step, before: job.steps[index - 1] }] : [];
    }));
    assert(installers.length > 0);
    if (file === "rls-session.yml") assert(Object.values(jobs).some((job) => job.steps?.some((step) => /\b(curl|apt-get)\b/.test(step.run ?? ""))));
    for (const { step, before } of installers) {
      const env = step.env;
      assert.match(before.uses, /^actions\/cache@[0-9a-f]{40}$/);
      assert.equal(before.with?.path, `~/.cache/pubmax-tools/${env.TOOL_NAME}-${env.TOOL_VERSION}-${env.TOOL_SHA256}`);
      assert(before.with?.key.includes(env.TOOL_VERSION));
      assert(before.with?.key.includes(env.TOOL_SHA256));
      assert.match(env.TOOL_SHA256, /^[0-9a-f]{64}$/);
      assert.match(env.TOOL_URL, /^https:\/\/github\.com\/.+\/releases\/download\//);
      assert(env.TOOL_URL.includes(env.TOOL_VERSION));
      if (env.TOOL_FALLBACK === "pip") assert.match(env.TOOL_PIP_REQUIREMENT, new RegExp(`==${env.TOOL_VERSION} --hash=sha256:[0-9a-f]{64}$`));
      else if (env.TOOL_FALLBACK === "docker") {
        assert.equal(env.TOOL_IMAGE, "postgrest/postgrest@sha256:bea1c76a856fa39d1e542d25911cf95d02fe2bf971992d033044ff209f1504b8");
        assert.equal(env.TOOL_IMAGE_PATH, "/bin/postgrest");
        assert.equal(env.TOOL_BINARY_SHA256, "9d363ab48d45a2d02d8ab82f8e9c6b541eca87c86be76bad5a3ff090ae03f3cc");
      } else {
        assert.equal(env.TOOL_FALLBACK, "go");
        assert.match(env.TOOL_GO_MODULE, new RegExp(`@v${env.TOOL_VERSION}$`));
      }
    }
  });
}

export function commandPolicy(workflows, check) {
  downloadPolicy(workflows, check);
  const all = Object.fromEntries(workflows.map(({ file, parsed }) => [file, parsed]));
  check("freshness.yml", "freshness detects data changes and fails closed", () => {
    const workflow = all["freshness.yml"];
    const detection = workflow.jobs["change-scope"];
    const classify = detection.steps.find((entry) => entry.id === "scope");
    const fetch = detection.steps.find((entry) => entry.name === "Fetch the queue range");
    assert(!Object.hasOwn(all["ci.yml"].jobs, "freshness"));
    assert.deepEqual(Object.keys(workflow.on).sort(), ["merge_group", "pull_request", "schedule", "workflow_dispatch"]);
    assert.equal(workflow.on.pull_request, null);
    assert.equal(workflow.on.merge_group, null);
    assert.deepEqual(workflow.on.schedule, [{ cron: "47 7 * * *" }]);
    assert.deepEqual(detection.outputs, { run: "${{ steps.scope.outputs.run }}" });
    assert.equal(detection.steps[0].with?.["fetch-depth"], 2);
    const range = { BASE_SHA: "${{ github.event.merge_group.base_sha }}", HEAD_SHA: "${{ github.event.merge_group.head_sha }}" };
    assert.deepEqual(classify.env, { EVENT_NAME: "${{ github.event_name }}", ...range });
    assert.equal(fetch.if, "github.event_name == 'merge_group'");
    assert.deepEqual(fetch.env, range);
    const freshness = workflow.jobs.freshness;
    assert.deepEqual(Array.isArray(freshness.needs) ? freshness.needs : [freshness.needs], ["change-scope"]);
    const expression = freshness.if.replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").replaceAll("needs.change-scope", 'needs["change-scope"]');
    for (const [result, run, expected] of [["success", "true", true], ["success", "false", false], ["failure", "", true], ["cancelled", "", true], ["skipped", "", true]]) {
      assert.equal(runInNewContext(`(${expression})`, { always: () => true, needs: { "change-scope": { result, outputs: { run } } } }, { timeout: 1000 }), expected);
    }
    assert.deepEqual(freshness.steps.filter((entry) => entry.uses).map((entry) => entry.uses.split("@")[0]), ["actions/checkout", "actions/setup-node"]);
  });
  check("security-ci.yml / gitleaks", "gitleaks receives the event and exact push range", () => {
    const step = all["security-ci.yml"].jobs.gitleaks.steps.find((entry) => entry.name === "gitleaks");
    assert.deepEqual(step.env, { EVENT_NAME: "${{ github.event_name }}", PUSH_BEFORE: "${{ github.event.before }}", PUSH_AFTER: "${{ github.sha }}" });
  });
  check("weather-refresh.yml", "weather refresh runs with temporary credentials and no branch condition", () => {
    const steps = all["weather-refresh.yml"].jobs.refresh.steps.filter((entry) => ["Configure review commit identity", "Refresh cache and open review PR"].includes(entry.name));
    assert.deepEqual(steps.map((entry) => entry.name), ["Configure review commit identity", "Refresh cache and open review PR"]);
    assert.equal(steps[1].env?.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
    for (const entry of steps) {
      assert.equal(entry.if, undefined);
      assert.equal(typeof entry.run, "string");
    }
  });
  check("prod-smoke.yml", "dispatched smoke binds the expected deployment and source commit", () => {
    const workflow = all["prod-smoke.yml"];
    const input = workflow.on.workflow_dispatch.inputs.deployment_id;
    assert.equal(input.required, false);
    assert.equal(input.type, "string");
    assert.equal(workflow["run-name"], "Production smoke ${{ inputs.deployment_id || github.run_id }}");
    const step = Object.values(workflow.jobs).flatMap((job) => job.steps).find((entry) => entry.env?.EXPECTED_DEPLOYMENT_ID);
    assert.equal(step.env.EXPECTED_DEPLOYMENT_ID, "${{ inputs.deployment_id }}");
    assert.equal(step.env.EVENT_NAME, "${{ github.event_name }}");
    assert.equal(step.env.EXPECTED_SHA, "${{ github.event.deployment.sha }}");
  });
  check("e2e.yml", "the Playwright report gate runs where the report is produced", () => {
    const steps = Object.values(all["e2e.yml"].jobs).flatMap((job) => job.steps);
    assert(steps.some((entry) => Object.hasOwn(entry.env ?? {}, "PLAYWRIGHT_JSON_OUTPUT_NAME")));
    assert(steps.some((entry) => (entry.run ?? "").includes("scripts/assert-playwright-gate.mjs")));
  });
}
