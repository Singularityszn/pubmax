import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { defined } from "@/__tests__/helpers/defined";

type WorkflowStep = {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
};

type Workflow = { jobs: { refresh: { steps: WorkflowStep[] } } };

describe("weather refresh workflow", () => {
  it("runs the approved PR command with a configured bot identity and temporary Git credentials", () => {
    const workflow = parse(readFileSync(join(process.cwd(), ".github/workflows/weather-refresh.yml"), "utf8")) as Workflow;
    const steps = workflow.jobs.refresh.steps.filter((step) =>
      ["Configure review commit identity", "Refresh cache and open review PR"].includes(step.name ?? ""),
    );
    expect(steps.map((step) => step.name)).toEqual([
      "Configure review commit identity",
      "Refresh cache and open review PR",
    ]);
    expect(steps[1]?.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");

    const root = mkdtempSync(join(process.cwd(), ".weather-workflow-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
      mkdirSync(join(root, "scripts/ci"), { recursive: true });
      copyFileSync(join(process.cwd(), "scripts/ci/with-git-token.sh"), join(root, "scripts/ci/with-git-token.sh"));
      mkdirSync(join(root, "bin"));
      writeFileSync(join(root, "bin/npm"), `#!${process.execPath}
const { execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const config = (key) => execFileSync("git", ["config", "--local", "--get", key], { encoding: "utf8" }).trim();
appendFileSync("refresh.jsonl", JSON.stringify({
  args: process.argv.slice(2),
  name: config("user.name"),
  email: config("user.email"),
  count: process.env.GIT_CONFIG_COUNT,
  key: process.env.GIT_CONFIG_KEY_0,
  value: process.env.GIT_CONFIG_VALUE_0,
}) + "\\n");
`, { mode: 0o755 });
      const env = {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        GIT_DIR: join(root, ".git"),
        GIT_WORK_TREE: root,
        GIT_INDEX_FILE: join(root, ".git/index"),
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_COUNT: "0",
        GH_TOKEN: "workflow-test-token",
        GITHUB_ACTIONS: "",
      };
      execFileSync("git", ["init", "--quiet"], { cwd: root, env });
      for (const step of steps) {
        expect(step.if).toBeUndefined();
        expect(step.run).toBeTypeOf("string");
        execFileSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", defined(step.run)], { cwd: root, env });
      }
      const refreshes = readFileSync(join(root, "refresh.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(refreshes).toEqual([{
        args: ["run", "refresh:weather", "--", "--open-pr"],
        name: "github-actions[bot]",
        email: "41898282+github-actions[bot]@users.noreply.github.com",
        count: "1",
        key: "http.https://github.com/.extraheader",
        value: `AUTHORIZATION: basic ${Buffer.from("x-access-token:workflow-test-token").toString("base64")}`,
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
