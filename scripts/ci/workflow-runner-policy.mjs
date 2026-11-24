import assert from "node:assert/strict";
import { browserJobCondition } from "./githubExpressions.ts";

const MACOS_JOBS = {
  "e2e.yml / layout-pins-1": "layout measured on macOS glyph widths",
  "e2e.yml / layout-pins-2": "layout measured on macOS glyph widths",
  "e2e.yml / layout-pins-3": "layout measured on macOS glyph widths",
  "e2e.yml / full-suite": "layout measured on macOS glyph widths",
  "e2e.yml / full-suite-gl": "layout measured on macOS glyph widths",
  "performance.yml / performance-budget": "budgets measured on macOS",
  "performance.yml / ux-lane-performance": "budgets measured on macOS",
  "prod-smoke.yml / smoke": "proved on macOS, one run per deploy",
};
const PINNED_LINUX = {
  "rls-session.yml / rls-session": {
    runner: "ubuntu-24.04",
    reason: "installs postgresql-16 from the Ubuntu archive, which ubuntu-26.04 does not carry",
  },
  "predeploy-gate.yml / commit": {
    runner: "ubuntu-24.04",
    reason: "keeps production release checks fixed when ubuntu-latest moves to another image",
  },
  "predeploy-gate.yml / ledger": {
    runner: "ubuntu-24.04",
    reason: "keeps production release checks fixed when ubuntu-latest moves to another image",
  },
  "predeploy-gate.yml / freshness": {
    runner: "ubuntu-24.04",
    reason: "keeps production release checks fixed when ubuntu-latest moves to another image",
  },
};
export const workflowExpressions = (value) => {
  if (typeof value === "string") return [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1]);
  if (Array.isArray(value)) return value.flatMap(workflowExpressions);
  return value && typeof value === "object" ? Object.values(value).flatMap(workflowExpressions) : [];
};

export function runnerPolicy(workflows, actions, check) {
  const seen = [];
  for (const { file, parsed, source = "" } of workflows) {
    if (!parsed?.jobs || !parsed.on) continue;
    const triggers = typeof parsed.on === "string" ? [parsed.on] : Object.keys(parsed.on);
    check(file, "pull request workflows expose no repository secrets", () => {
      if (triggers.some((trigger) => trigger.startsWith("pull_request"))) {
        for (const expression of workflowExpressions(parsed)) assert.doesNotMatch(expression, /\bsecrets\b/);
      }
    });
    check(file, "pinned actions name their release tags", () => {
      for (const line of source.split("\n")) {
        const uses = /uses: ([^.\s][^\s]*@[0-9a-f]{40})(.*)$/.exec(line);
        if (uses) assert.match(uses[2], /^ # v\d/);
      }
    });
    check(file, "refresh credentials live for one step only", () => {
      for (const match of source.matchAll(/run: (.*--open-pr.*)$/gm)) assert.match(match[1], /^scripts\/ci\/with-git-token\.sh /);
    });
    if (file === "weekly-digest.yml") check(file, "digest has no service-role key before delivery is wired", () =>
      assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{/));
    for (const [id, job] of Object.entries(parsed.jobs)) {
      const where = `${file} / ${id}`;
      check(where, "runner is on the approved host list", () => {
        const expected = Object.hasOwn(MACOS_JOBS, where) ? "pubmax-mac" : PINNED_LINUX[where]?.runner ?? "ubuntu-latest";
        assert.equal(job["runs-on"], expected);
        if (expected !== "ubuntu-latest") {
          assert(MACOS_JOBS[where] ?? PINNED_LINUX[where]?.reason);
          seen.push(where);
        }
      });
      if (Object.hasOwn(MACOS_JOBS, where)) check(where, "fork pull requests never run on the Mac pool", () => {
        assert(!triggers.includes("pull_request_target"));
        if (!triggers.includes("pull_request")) return;
        for (const result of ["success", "failure", "cancelled", "skipped"]) {
          for (const layout of ["ui", "non-ui"]) {
            assert.equal(browserJobCondition(job.if, { fork: true, result, layout, labels: ["layout-pins"] }), false);
          }
        }
      });
    }
  }
  check(".github/workflows", "runner exception inventory", () => assert.deepEqual(seen.sort(), [...Object.keys(MACOS_JOBS), ...Object.keys(PINNED_LINUX)].sort()));
  const steps = workflows.flatMap(({ file, parsed }) => Object.entries(parsed?.jobs ?? {}).flatMap(([id, job]) =>
    (job.steps ?? []).map((step) => ({ where: `${file} / ${id}`, step }))));
  steps.push(...actions.flatMap(({ file, parsed }) => (parsed.runs?.steps ?? []).map((step) => ({ where: file, step }))));
  for (const { where, step } of steps) {
    check(where, "checkouts drop credentials and remote actions use full commit pins", () => {
      if (step.uses?.startsWith("actions/checkout@")) assert.equal(step.with?.["persist-credentials"], false);
      if (step.uses && !step.uses.startsWith("./")) assert.match(step.uses, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    });
    if (step.run && /\bnpm ci\b/.test(step.run) && !/--prefix/.test(step.run)) {
      check(where, "install scripts use the reviewed allowlist after npm ci", () => assert.match(step.run, /npm ci\n\s*npm run deps:install-scripts/));
    }
  }
}
