import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { browserJobCondition } from "./githubExpressions.ts";

const needsOf = (job) => job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
const scopeCondition = (condition, scope, shard = 1, failed = false) => Boolean(runInNewContext(`(${String(condition ?? true).trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1").replace(/needs\.([\w-]+)/g, 'needs["$1"]')})`, {
  steps: { scope: { outputs: { scope } } },
  needs: { "queue-proof": { result: "skipped", outputs: {} }, "unit-tests": { result: "success", outputs: {} } },
  matrix: { shard }, github: { event_name: "pull_request", ref: "refs/pull/1/merge" },
  success: () => !failed, failure: () => failed, cancelled: () => false, always: () => true,
}, { timeout: 1000 }));

function jobsThatRun(jobs, event, proof, outcomes = {}) {
  const results = {};
  const pending = Object.keys(jobs);
  while (pending.length > 0) {
    const index = pending.findIndex((id) => needsOf(jobs[id]).every((need) => need in results));
    assert(index >= 0, "a job waits for a job that never reports");
    const [id] = pending.splice(index, 1);
    const job = jobs[id];
    const needs = Object.fromEntries(needsOf(job).map((need) => [need, results[need]]));
    const ancestors = new Set(needsOf(job));
    for (const need of ancestors) for (const upstream of needsOf(jobs[need])) ancestors.add(upstream);
    const allSucceeded = () => [...ancestors].every((need) => results[need].result === "success");
    const expression = String(job.if ?? "true").trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
    const translated = expression.replaceAll("needs.*.result", "Object.values(needs).map((need) => need.result)")
      .replaceAll("github.event.pull_request.labels.*.name", "pullRequestLabels").replace(/needs\.([\w-]+)/g, 'needs["$1"]');
    const holds = runInNewContext(`(${translated})`, {
      github: { event_name: event, repository: "Singularityszn/pubmax", event: { pull_request: { head: { repo: { full_name: "Singularityszn/pubmax" } } } } },
      needs, pullRequestLabels: [], always: () => true, cancelled: () => false,
      success: allSucceeded, failure: () => false, contains: (list, value) => list.includes(value),
    }, { timeout: 1000 });
    const runs = Boolean(holds) && (/\b(always|cancelled|success|failure)\(/.test(expression) || allSucceeded());
    if (!runs) results[id] = { result: "skipped", outputs: {} };
    else if (id === "queue-proof") results[id] = { result: proof.result, outputs: proof.passed ? { passed: proof.passed } : {} };
    else results[id] = { result: outcomes[id] ?? "success", outputs: id === "change-scope" ? { scope: "code", layout: "ui" } : {} };
  }
  return Object.keys(results).filter((id) => results[id].result !== "skipped").sort();
}

export function scopePolicy(workflows, check) {
  const all = Object.fromEntries(workflows.map(({ file, parsed }) => [file, parsed]));
  const gated = workflows.flatMap(({ file, parsed }) => Object.entries(parsed?.jobs ?? {})
    .filter(([, job]) => job.steps?.some((entry) => entry.name === "Classify the change"))
    .map(([id, job]) => ({ where: `${file} / ${id}`, job })));
  check(".github/workflows", "heavy jobs use one identical change classifier", () => {
    assert.deepEqual(gated.map(({ where }) => where).sort(), ["ci.yml / coverage", "ci.yml / lint-and-types", "ci.yml / production-build", "ci.yml / typecheck-ts6", "ci.yml / unit-tests", "e2e.yml / change-scope", "e2e.yml / law-pins", "rls-session.yml / rls-session"]);
    const canonical = gated[0].job.steps.find((entry) => entry.name === "Classify the change").run;
    for (const { where, job } of gated) {
      const classify = job.steps.find((entry) => entry.name === "Classify the change");
      assert.equal(classify.id, "scope", where);
      assert.equal(classify.run, canonical, where);
      assert.match(job.steps[0].uses, /^actions\/checkout@/, where);
      assert.equal(job.steps[0].with?.["fetch-depth"], 2, where);
      assert.equal(job.steps.indexOf(classify), 1, where);
    }
  });
  for (const { where, job } of gated) check(where, "pull request step conditions preserve the docs, data and code scopes", () => {
    for (const [scope, heavy, types, named] of [["code", true, true, false], ["data", false, true, true], ["docs", false, false, true]]) {
      for (const shard of [1, 2, 3]) {
        assert.equal(where.startsWith("e2e.yml") ? browserJobCondition(job.if) : scopeCondition(job.if, scope, shard), true);
        const classifier = job.steps.findIndex((entry) => entry.name === "Classify the change");
        for (const [index, entry] of job.steps.entries()) {
          if (where === "e2e.yml / law-pins" && entry.uses?.startsWith("actions/upload-artifact@")) {
            assert.equal(scopeCondition(entry.if, scope, shard), false);
            assert.equal(scopeCondition(entry.if, scope, shard, true), heavy);
            continue;
          }
          let expected = heavy;
          if (where === "e2e.yml / change-scope" || index <= classifier) expected = true;
          else if (["ci.yml / lint-and-types", "ci.yml / typecheck-ts6"].includes(where)) expected = types;
          else if (where === "ci.yml / unit-tests") {
            if (["Setup Node", "Install dependencies", "Build slim venue artifacts"].includes(entry.name)) expected = heavy || shard === 1;
            else if (entry.name === "Unit tests that name a changed file") expected = named && shard === 1;
          } else if (where === "ci.yml / production-build" && entry.name === "Save the Next.js build cache") expected = false;
          assert.equal(scopeCondition(entry.if, scope, shard), expected, `${entry.name} / ${scope} / ${shard}`);
        }
      }
    }
  });
  check("ci.yml / security-ci.yml", "data validation, review scope and security remain eligible for every scope", () => {
    for (const scope of ["code", "data", "docs"]) {
      const jobs = [...["validate-data", "review-scope"].map((id) => all["ci.yml"].jobs[id]),
        ...Object.entries(all["security-ci.yml"].jobs).filter(([id]) => id !== "queue-proof").map(([, job]) => job)];
      for (const job of jobs) {
        assert.equal(scopeCondition(job.if, scope), true);
        for (const entry of job.steps) assert.equal(scopeCondition(entry.if, scope), true, entry.name);
      }
    }
  });
  const mainOnly = { "ci.yml": ["production-build", "review-scope"], "e2e.yml": ["change-scope"], "rls-session.yml": [], "security-ci.yml": [] };
  for (const [file, kept] of Object.entries(mainOnly)) check(file, "main skips only work proved by a green merge queue run", () => {
    const jobs = all[file].jobs;
    assert.deepEqual(jobsThatRun(jobs, "push", { result: "success", passed: "true" }), ["check", "queue-proof", ...kept].sort());
    const proved = Object.keys(jobs).filter((id) => needsOf(jobs[id]).includes("queue-proof"));
    assert(proved.length > 0);
    for (const [event, proof] of [["push", { result: "success", passed: "false" }], ["push", { result: "failure" }], ["pull_request", { result: "success", passed: "true" }], ["merge_group", { result: "success", passed: "true" }]]) {
      const running = jobsThatRun(jobs, event, proof);
      for (const id of proved) assert(running.includes(id), `${event} / ${id}`);
      assert.equal(running.includes("queue-proof"), event === "push");
      if (file === "ci.yml") assert(running.includes("coverage"));
    }
    if (file === "ci.yml") {
      for (const event of ["pull_request", "merge_group"]) {
        const running = jobsThatRun(jobs, event, { result: "success" });
        assert(!running.includes("queue-proof"));
        assert(running.includes("unit-tests"));
        assert(running.includes("coverage"));
      }
      for (const result of ["failure", "cancelled", "skipped"]) assert(!jobsThatRun(jobs, "pull_request", { result: "success" }, { "unit-tests": result }).includes("coverage"));
    }
  });
}
