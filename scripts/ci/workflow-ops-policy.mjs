import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { parseArgs } from "../enrich_city_pubs_tavily.mjs";
import { UPTIME_REQUEST_TIMEOUT_MS, UPTIME_RETRY_DELAY_MS } from "./uptime-check.mjs";
import { PRODUCTION_SITE_ORIGIN } from "../../lib/siteUrlConfig.mjs";
import { workflowExpressions } from "./workflow-runner-policy.mjs";

function cronMinutes(field) {
  const minutes = new Set();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    const [low, high] = range === "*" ? [0, 59] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stepText === undefined ? Number(range) : 59];
    assert(Number.isInteger(step) && step > 0 && low >= 0 && high <= 59 && low <= high);
    for (let minute = low; minute <= high; minute += step) minutes.add(minute);
  }
  return [...minutes].sort((a, b) => a - b);
}

function importClosure(entry) {
  const files = new Set();
  const bare = new Set();
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    const text = readFileSync(file, "utf8");
    const specifiers = [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g), ...text.matchAll(/^\s*import\s+["']([^"']+)["']/gm), ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) bare.add(specifier);
      else visit(normalize(join(dirname(file), specifier)).split("\\").join("/"));
    }
  };
  visit(entry);
  return { files: [...files].sort(), bare: [...bare].sort() };
}

export function opsPolicy(workflows, check) {
  const all = Object.fromEntries(workflows.map(({ file, parsed }) => [file, parsed]));
  check("alert-on-failure.yml", "every unattended workflow alerts on failure without running repository code", () => {
    const watched = workflows.filter(({ file, parsed }) => file !== "alert-on-failure.yml" && (parsed?.on?.schedule !== undefined || Object.hasOwn(parsed?.on ?? {}, "deployment_status"))).map(({ file, parsed }) => parsed.name ?? file);
    assert(watched.length >= 8);
    for (const name of ["Production smoke", "API performance"]) assert(watched.includes(name));
    const alert = all["alert-on-failure.yml"];
    const job = alert.jobs.alert;
    assert.deepEqual([...alert.on.workflow_run.workflows].sort(), watched.sort());
    assert.deepEqual(alert.on.workflow_run.types, ["completed"]);
    assert.equal(job.if.replace(/\s+/g, " ").trim(), "contains(fromJSON('[\"failure\", \"timed_out\", \"startup_failure\"]'), github.event.workflow_run.conclusion) && contains(fromJSON('[\"schedule\", \"deployment_status\"]'), github.event.workflow_run.event)");
    assert.deepEqual(alert.permissions, {});
    assert.equal(job.env.ALERT_WEBHOOK_URL, "${{ secrets.PUBMAX_ALERT_WEBHOOK_URL }}");
    assert(job.steps.length > 0);
    for (const step of job.steps) assert.equal(step.uses, undefined);
  });
  const uptime = all["uptime.yml"];
  if (uptime) check("uptime.yml", "one credential-free uptime probe every five minutes with its complete sparse checkout", () => {
    assert.equal(uptime.name, "Production uptime");
    assert.deepEqual(Object.keys(uptime.on).sort(), ["schedule", "workflow_dispatch"]);
    assert.equal(uptime.on.schedule.length, 1);
    const fields = uptime.on.schedule[0].cron.trim().split(/\s+/);
    assert.equal(fields.length, 5);
    assert.deepEqual(fields.slice(1), ["*", "*", "*", "*"]);
    const minutes = cronMinutes(fields[0]);
    assert.equal(minutes.length, 12);
    assert(!minutes.includes(0));
    assert.deepEqual(new Set(minutes.map((minute, index) => (minutes[(index + 1) % minutes.length] - minute + 60) % 60)), new Set([5]));
    assert.equal(Object.keys(uptime.jobs).length, 1);
    const job = Object.values(uptime.jobs)[0];
    assert.deepEqual(uptime.permissions, {});
    assert.deepEqual(job.permissions, { contents: "read" });
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert(job["timeout-minutes"] > 0 && job["timeout-minutes"] <= 5);
    // Two asks, a pause and a margin fit well inside the job's wall.
    const jobWallMs = job["timeout-minutes"] * 60_000;
    assert(2 * UPTIME_REQUEST_TIMEOUT_MS + UPTIME_RETRY_DELAY_MS < jobWallMs / 2);
    assert.equal(job.env, undefined);
    assert.deepEqual(uptime.concurrency, { group: "${{ github.workflow }}", "cancel-in-progress": false });
    assert.doesNotMatch(JSON.stringify(uptime), /https?:\/\//);
    assert(!JSON.stringify(uptime).includes(new URL(PRODUCTION_SITE_ORIGIN).hostname));
    for (const expression of workflowExpressions(uptime)) assert.doesNotMatch(expression, /\bsecrets\b/);
    for (const step of job.steps) if (step.run) assert(!step.run.includes("${{"));
    const script = "scripts/ci/uptime-check.mjs";
    assert.deepEqual(job.steps.flatMap((step) => step.run ? [step.run.trim()] : []), [`node ${script}`]);
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with?.["persist-credentials"], false);
    assert.equal(checkout.with?.["sparse-checkout-cone-mode"], false);
    const sparse = String(checkout.with?.["sparse-checkout"] ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.replace(/^\//, "")).sort();
    const closure = importClosure(script);
    assert.deepEqual(sparse, closure.files);
    assert.deepEqual(closure.bare, []);
    assert(closure.files.includes("lib/siteUrlConfig.mjs"));
    assert(all["alert-on-failure.yml"].on.workflow_run.workflows.includes("Production uptime"));
  });
  const nightly = all["tavily-london-nightly.yml"];
  if (nightly) check("tavily-london-nightly.yml", "nightly London uses code ceilings, saves its checkpoint and validates before review", () => {
    const steps = nightly.jobs.pass.steps;
    const pass = steps.findIndex((step) => /^npm run enrich:city /.test(step.run ?? ""));
    const validate = steps.findIndex((step) => step.run === "npm run validate-data");
    const pr = steps.findIndex((step) => /tavily-london-review-pr\.sh$/.test(step.run ?? ""));
    assert(pass >= 0 && validate > pass && pr > validate);
    assert.deepEqual(nightly.on.schedule.map((entry) => entry.cron), ["30 2 * * *"]);
    assert(Object.hasOwn(nightly.on, "workflow_dispatch"));
    assert.equal(JSON.parse(readFileSync("package.json", "utf8")).scripts["enrich:city"], "tsx scripts/enrich_city_pubs_tavily.mjs");
    assert.deepEqual(parseArgs(steps[pass].run.split(" -- ")[1].trim().split(/\s+/)), { city: "london", maxQueries: 200, maxCredits: 400, reset: false, dryRun: false });
    assert.deepEqual(nightly.concurrency, { group: "tavily-london-nightly", "cancel-in-progress": false });
    const restore = steps.findIndex((step) => step.uses?.startsWith("actions/cache/restore@"));
    const save = steps.findIndex((step) => step.uses?.startsWith("actions/cache/save@"));
    assert(restore >= 0 && restore < pass && save > pass && save < validate);
    assert.equal(steps[save].if, "${{ !cancelled() }}");
    assert.equal(steps[save].with?.path, ".tavily/enrichment/london.json");
    assert.equal(steps[restore].with?.path, steps[save].with?.path);
    assert.deepEqual(nightly.permissions, {});
  });
  check("rls-session.yml", "the PostgreSQL proofs run where their cluster is installed", () => {
    const runs = Object.values(all["rls-session.yml"].jobs).flatMap((job) => job.steps ?? []).map((step) => step.run ?? "").join("\n");
    assert(runs.includes("postgresql-16"));
    assert(runs.includes("npm run test:rls"));
  });
}
