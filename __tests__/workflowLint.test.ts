import { describe, expect, it } from "vitest";

import { lintWorkflows } from "@/scripts/ci/lint-workflows.mjs";

function findings(file: string, parsed: unknown, policy: string) {
  return lintWorkflows([{ file, parsed }]).filter((finding) =>
    (finding.startsWith(`${file}:`) || finding.startsWith(`${file} / `)) && finding.includes(`: ${policy}`));
}

describe("workflow policy lint", () => {
  it.each([
    { runner: "ubuntu-latest", expected: 0 },
    { runner: "self-hosted", expected: 1 },
  ])("reports an unapproved runner: $runner", ({ runner, expected }) => {
    expect(findings("example.yml", {
      on: { workflow_dispatch: null }, jobs: { build: { "runs-on": runner, steps: [] } },
    }, "runner is on the approved host list")).toHaveLength(expected);
  });

  it.each([
    { persist: false, expected: 0 },
    { persist: true, expected: 1 },
  ])("reports a persisted checkout token: $persist", ({ persist, expected }) => {
    expect(findings("example.yml", {
      on: { workflow_dispatch: null },
      jobs: { build: { "runs-on": "ubuntu-latest", steps: [{
        uses: `actions/checkout@${"a".repeat(40)}`, with: { "persist-credentials": persist },
      }] } },
    }, "checkouts drop credentials")).toHaveLength(expected);
  });

  it.each([
    { order: ["npm run build:slim\nnpx vitest run", "npm run refresh:events -- --with-common --open-pr"], expected: 0 },
    { order: ["npm run refresh:events -- --with-common --open-pr", "npm run build:slim"], expected: 1 },
    { order: ["echo npm run build:slim", "npm run refresh:events -- --with-common --open-pr"], expected: 1 },
  ])("checks event build order across YAML run blocks: $order", ({ order, expected }) => {
    expect(findings("events-refresh.yml", {
      on: { workflow_dispatch: null }, jobs: { refresh: { steps: order.map((run) => ({ run })) } },
    }, "build venue details before refreshing events")).toHaveLength(expected);
  });

  it("rejects secret expressions but accepts plain commands", () => {
    expect(findings("example.yml", {
      on: "pull_request", jobs: { build: { steps: [{ env: { KEY: "${{ toJSON(secrets) }}" } }] } },
    }, "pull request workflows expose no repository secrets")).toHaveLength(1);
    expect(findings("example.yml", {
      on: "pull_request", jobs: { build: { steps: [{ run: "echo done" }] } },
    }, "pull request workflows expose no repository secrets")).toHaveLength(0);
  });

  it.each([
    { needs: ["build"], expected: 0 },
    { needs: [], expected: 1 },
  ])("requires every summary dependency: $needs", ({ needs, expected }) => {
    expect(findings("ci.yml", {
      on: "pull_request", jobs: {
        build: { name: "Build", steps: [] },
        check: { name: "CI check", needs, if: "always()", "timeout-minutes": 5, steps: [] },
      },
    }, "required summary covers")).toHaveLength(expected);
  });

  it.each([
    { concurrency: undefined, expected: 0 },
    { concurrency: { group: "all-browser-jobs" }, expected: 1 },
  ])("rejects a browser job concurrency group: $concurrency", ({ concurrency, expected }) => {
    expect(findings("example.yml", {
      on: "workflow_dispatch", jobs: { browser: { concurrency, steps: [{ run: "npx playwright test" }] } },
    }, "browser jobs do not share a concurrency group")).toHaveLength(expected);
  });

  it.each([
    { condition: "github.event.pull_request.head.repo.full_name == github.repository", expected: 0 },
    { condition: "true", expected: 1 },
  ])("rejects a Mac fork bypass: $condition", ({ condition, expected }) => {
    expect(findings("e2e.yml", {
      on: "pull_request", jobs: { "layout-pins-1": { if: condition, "runs-on": "pubmax-mac", steps: [] } },
    }, "fork pull requests never run on the Mac pool")).toHaveLength(expected);
  });

  it.each([
    { triggers: { pull_request: null, merge_group: null }, expected: 0 },
    { triggers: { pull_request: null }, expected: 1 },
  ])("requires merge-queue reporting: $triggers", ({ triggers, expected }) => {
    expect(findings("ci.yml", { on: triggers, jobs: {} }, "required checks run for pull requests and merge groups")).toHaveLength(expected);
  });

  it("reports policy failures without suppressing later findings", () => {
    const result = lintWorkflows([{ file: "example.yml", parsed: {
      on: "pull_request", jobs: { build: { "runs-on": "self-hosted", steps: [{ uses: "actions/checkout@main" }] } },
    } }]);
    expect(result.some((finding) => finding.includes("runner is on the approved host list"))).toBe(true);
    expect(result.some((finding) => finding.includes("checkouts drop credentials"))).toBe(true);
  });
});
