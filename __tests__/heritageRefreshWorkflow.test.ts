import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { defined } from "@/__tests__/helpers/defined";

type WorkflowStep = {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
};

type Workflow = {
  jobs: { refresh: { env: Record<string, string>; steps: WorkflowStep[] } };
};

type BoundaryCall = {
  command: string;
  args: string[];
  count?: string;
  key?: string;
  value?: string;
};

const refreshedPaths = [
  "public/data/wikidata_history/london.json",
  "public/data/heritage_listings.json",
  "data/heritage/nhle_london_points.json",
  "public/data/heritage_cache.json",
  "public/data/historic_pubs.json",
  "data/freshness_registry.json",
];

describe("heritage refresh publication", () => {
  it.each([
    { name: "unchanged facts", changed: [] },
    { name: "unrelated changes only", changed: ["unrelated.txt"] },
    { name: "all refreshed outputs", changed: refreshedPaths },
    { name: "only the freshness stamp", changed: ["data/freshness_registry.json"] },
  ])("publishes only approved changes with $name", ({ changed }) => {
    const workflow = parse(readFileSync(join(process.cwd(), ".github/workflows/heritage-refresh.yml"), "utf8")) as Workflow;
    const job = workflow.jobs.refresh;
    const steps = job.steps.filter((step) =>
      ["Configure review commit identity", "Open review PR when the facts changed"].includes(step.name ?? ""),
    );
    expect(steps.map((step) => step.name)).toEqual([
      "Configure review commit identity",
      "Open review PR when the facts changed",
    ]);
    expect(steps[1]?.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");

    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const root = mkdtempSync(join(process.cwd(), ".heritage-workflow-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
      writeFileSync(join(root, "calls.jsonl"), "");
      mkdirSync(join(root, "scripts/ci"), { recursive: true });
      copyFileSync(join(process.cwd(), "scripts/ci/with-git-token.sh"), join(root, "scripts/ci/with-git-token.sh"));

      writeFileSync(join(bin, "git"), `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "push") {
  appendFileSync("calls.jsonl", JSON.stringify({
    command: "git", args,
    count: process.env.GIT_CONFIG_COUNT,
    key: process.env.GIT_CONFIG_KEY_0,
    value: process.env.GIT_CONFIG_VALUE_0,
  }) + "\\n");
} else {
  const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
`, { mode: 0o755 });
      for (const command of ["npm", "gh"]) {
        writeFileSync(join(bin, command), `#!${process.execPath}
const { appendFileSync } = require("node:fs");
appendFileSync("calls.jsonl", JSON.stringify({ command: ${JSON.stringify(command)}, args: process.argv.slice(2) }) + "\\n");
`, { mode: 0o755 });
      }
      writeFileSync(join(bin, "date"), '#!/bin/sh\nprintf "%s\\n" "2026-11-12"\n', { mode: 0o755 });

      const env = {
        ...process.env,
        ...job.env,
        PATH: `${bin}:${process.env.PATH}`,
        GIT_DIR: join(root, ".git"),
        GIT_WORK_TREE: root,
        GIT_INDEX_FILE: join(root, ".git/index"),
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_COUNT: "0",
        GH_TOKEN: "workflow-test-token",
        GITHUB_ACTIONS: "",
        GITHUB_RUN_ID: "123456",
      };
      const git = (...args: string[]) => execFileSync(realGit, args, { cwd: root, env, encoding: "utf8" }).trim();
      git("init", "--quiet", "--initial-branch=main");
      git("config", "core.hooksPath", devNull);
      git("config", "user.name", "Fixture author");
      git("config", "user.email", "fixture@example.test");
      for (const path of [...refreshedPaths, "unrelated.txt"]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), "original\n");
      }
      git("add", "--", ...refreshedPaths, "unrelated.txt");
      git("commit", "--quiet", "-m", "Fixture baseline");
      const baseline = git("rev-parse", "HEAD");
      for (const path of changed) writeFileSync(join(root, path), "refreshed\n");
      writeFileSync(join(root, "untracked.txt"), "Do not publish\n");
      if (changed.some((path) => refreshedPaths.includes(path))) {
        writeFileSync(join(root, "unrelated.txt"), "Do not publish\n");
      }

      for (const step of steps) {
        expect(step.if).toBeUndefined();
        execFileSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", defined(step.run)], { cwd: root, env, encoding: "utf8" });
      }

      const calls: BoundaryCall[] = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const expectedChanges = changed.filter((path) => refreshedPaths.includes(path));
      expect(git("rev-parse", "main")).toBe(baseline);
      expect(git("config", "--local", "--list")).not.toContain("extraheader=");
      if (expectedChanges.length === 0) {
        expect(git("rev-parse", "HEAD")).toBe(baseline);
        expect(git("branch", "--show-current")).toBe("main");
        expect(git("for-each-ref", "--format=%(refname:short)", "refs/heads")).toBe("main");
        expect(calls).toEqual([]);
      } else {
        const branch = "heritage-refresh/2026-11-12-123456";
        expect(git("branch", "--show-current")).toBe(branch);
        expect(git("rev-list", "--count", `${baseline}..HEAD`)).toBe("1");
        expect(git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").sort())
          .toEqual([...expectedChanges].sort());
        expect(git("show", "--format=%an <%ae>", "--no-patch", "HEAD"))
          .toBe("github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>");
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({
          command: "git",
          args: ["push", "--set-upstream", "origin", branch],
          count: "1",
          key: "http.https://github.com/.extraheader",
          value: `AUTHORIZATION: basic ${Buffer.from("x-access-token:workflow-test-token").toString("base64")}`,
        });
        expect(calls[1]?.command).toBe("gh");
        const prArgs = defined(calls[1]).args;
        expect(prArgs.slice(0, 2)).toEqual(["pr", "create"]);
        expect(prArgs[prArgs.indexOf("--base") + 1]).toBe("main");
        expect(prArgs[prArgs.indexOf("--head") + 1]).toBe(branch);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
