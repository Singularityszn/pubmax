import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { defined } from "@/__tests__/helpers/defined";

type BoundaryCall = {
  command: string;
  args: string[];
  count?: string;
  key?: string;
  value?: string;
};

type PublicationScenario = {
  name: string;
  changed: string[];
  staged?: boolean;
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
  it.each<PublicationScenario>([
    { name: "unchanged facts", changed: [] },
    { name: "unrelated changes only", changed: ["unrelated.txt"] },
    { name: "all refreshed outputs", changed: refreshedPaths },
    ...refreshedPaths.map((path) => ({ name: `only ${path}`, changed: [path] })),
    { name: "staged facts", changed: ["public/data/historic_pubs.json"], staged: true },
  ])("publishes only approved changes with $name", ({ changed, staged = false }) => {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const root = mkdtempSync(join(process.cwd(), ".heritage-workflow-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
      writeFileSync(join(root, "calls.jsonl"), "");
      mkdirSync(join(root, "scripts/ci"), { recursive: true });
      copyFileSync(join(process.cwd(), "scripts/ci/with-git-token.sh"), join(root, "scripts/ci/with-git-token.sh"));
      copyFileSync(join(process.cwd(), "scripts/publish_heritage_refresh.mjs"), join(root, "scripts/publish_heritage_refresh.mjs"));

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
      writeFileSync(join(bin, "gh"), `#!${process.execPath}
const { appendFileSync } = require("node:fs");
appendFileSync("calls.jsonl", JSON.stringify({ command: "gh", args: process.argv.slice(2) }) + "\\n");
`, { mode: 0o755 });
      writeFileSync(join(bin, "date"), '#!/bin/sh\nprintf "%s\\n" "2026-11-12"\n', { mode: 0o755 });

      const env = {
        ...process.env,
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
      if (staged) git("add", "--", ...changed);
      writeFileSync(join(root, "untracked.txt"), "Do not publish\n");
      if (changed.some((path) => refreshedPaths.includes(path))) {
        writeFileSync(join(root, "unrelated.txt"), "Do not publish\n");
        git("add", "--", "unrelated.txt");
      }

      execFileSync(process.execPath, ["scripts/publish_heritage_refresh.mjs"], { cwd: root, env, encoding: "utf8" });

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
        expect(git("diff", "--cached", "--name-only")).toBe("unrelated.txt");
        expect(git("show", "HEAD:unrelated.txt")).toBe("original");
        expect(git("show", `HEAD:${expectedChanges[0]}`)).toBe("refreshed");
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
