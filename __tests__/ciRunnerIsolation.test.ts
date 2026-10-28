// A PUBLIC REPO DOES NOT RUN CI ON A PERSONAL MACHINE.
//
// Every job uses GitHub-hosted ubuntu-latest, except the closed list of
// Playwright jobs in MACOS_JOBS. Pull request workflows do not reference the
// secrets context, so a fork cannot read a repository secret.
// docs/CI_RUNBOOK.md is the runbook.
//
//   1. no dependency runs an install script unless the allowlist says so;
//   2. no pre/post npm hook exists for `ignore-scripts` to skip in silence;
//   3. every checkout drops its credential, and every remote action is pinned
//      to a commit;
//   4. only the jobs in MACOS_JOBS use macos-latest, every other job uses
//      ubuntu-latest, and a pull request workflow has no secrets.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  INSTALL_SCRIPT_REASONS,
  PACKAGE_DIRS,
  checkAllowlist,
  packagesWithInstallScripts,
} from "@/scripts/ci/install-script-allowlist.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  "runs-on": string;
  permissions?: Record<string, string>;
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

const WORKFLOW_DIR = join(ROOT, ".github/workflows");
const workflows: Array<{ file: string; source: string; parsed: Workflow }> = readdirSync(WORKFLOW_DIR)
  .filter((file) => file.endsWith(".yml"))
  .sort()
  .map((file) => {
    const source = readFileSync(join(WORKFLOW_DIR, file), "utf8");
    return { file, source, parsed: parse(source) as Workflow };
  });

const ACTION_DIR = join(ROOT, ".github/actions");
const compositeActions = readdirSync(ACTION_DIR).map((dir) => ({
  file: `${dir}/action.yml`,
  parsed: parse(readFileSync(join(ACTION_DIR, dir, "action.yml"), "utf8")) as { runs: { steps: Step[] } },
}));

function everyStep(): Array<{ where: string; step: Step }> {
  const steps: Array<{ where: string; step: Step }> = [];
  for (const { file, parsed } of workflows) {
    for (const [jobId, job] of Object.entries(parsed.jobs)) {
      for (const step of job.steps) steps.push({ where: `${file} / ${jobId}`, step });
    }
  }
  for (const { file, parsed } of compositeActions) {
    for (const step of parsed.runs.steps) steps.push({ where: file, step });
  }
  return steps;
}

function triggers(workflow: Workflow): string[] {
  return typeof workflow.on === "string" ? [workflow.on] : Object.keys(workflow.on);
}

function expressions(value: unknown): string[] {
  if (typeof value === "string") return [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => defined(match[1]));
  if (Array.isArray(value)) return value.flatMap(expressions);
  if (value && typeof value === "object") return Object.values(value).flatMap(expressions);
  return [];
}

describe("dependency install scripts", () => {
  it("are off in every package this repo installs", () => {
    for (const npmrc of [".npmrc", "scripts/chatgpt-map/.npmrc"]) {
      const lines = readFileSync(join(ROOT, npmrc), "utf8").split("\n").map((line) => line.trim());
      expect(lines, npmrc).toContain("ignore-scripts=true");
    }
  });

  it("leave no pre or post npm hook for ignore-scripts to skip without a word", () => {
    // `ignore-scripts` also skips `prebuild` around `npm run build`. A hook
    // left in place would vanish from the build on every machine at once.
    for (const manifest of ["package.json", "scripts/chatgpt-map/package.json"]) {
      const scripts: Record<string, string> = JSON.parse(readFileSync(join(ROOT, manifest), "utf8")).scripts;
      const hooks = Object.keys(scripts).filter((name) => {
        const hooked = /^(pre|post)(.+)$/.exec(name)?.[2];
        return hooked !== undefined && Object.hasOwn(scripts, hooked);
      });
      expect(hooks, manifest).toEqual([]);
    }
  });

  it("run only from allowScripts, which covers every lockfile and nothing more", () => {
    for (const dir of PACKAGE_DIRS) {
      const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
      const lock = JSON.parse(readFileSync(join(ROOT, dir, "package-lock.json"), "utf8"));
      const result = checkAllowlist(
        packagesWithInstallScripts(lock),
        manifest.allowScripts ?? {},
        INSTALL_SCRIPT_REASONS,
      );
      expect(result.unlisted, dir).toEqual([]);
      expect(result.stale, dir).toEqual([]);
      expect(result.unexplained, dir).toEqual([]);
      expect(result.notBoolean, dir).toEqual([]);
    }
    for (const [name, reason] of Object.entries(INSTALL_SCRIPT_REASONS)) {
      expect(reason, `${name} needs a reason`).toMatch(/^(runs|skipped): .{20,}/);
    }
  });

  it("refuses a new install script nobody has read, and a row for a package that left", () => {
    const lock = {
      packages: {
        "": { name: "app" },
        "node_modules/esbuild": { hasInstallScript: true },
        "node_modules/tsx/node_modules/esbuild": { hasInstallScript: true },
        "node_modules/@scope/native": { hasInstallScript: true },
        "node_modules/plain": {},
      },
    };
    expect(packagesWithInstallScripts(lock)).toEqual(["@scope/native", "esbuild"]);

    const result = checkAllowlist(
      packagesWithInstallScripts(lock),
      { esbuild: true, gone: false, mystery: true },
      { esbuild: "runs: links the platform binary", gone: "skipped: no longer installed" },
    );
    expect(result.unlisted).toEqual(["@scope/native"]);
    expect(result.stale).toEqual(["gone", "mystery"]);
    expect(result.unexplained).toEqual(["mystery"]);
    expect(result.toRun).toEqual(["esbuild"]);
  });

  it("are rebuilt from the allowlist straight after every npm ci", () => {
    for (const { where, step } of everyStep()) {
      if (!step.run || !/\bnpm ci\b/.test(step.run) || /--prefix/.test(step.run)) continue;
      expect(step.run, where).toMatch(/npm ci\n\s*npm run deps:install-scripts/);
    }
  });

  it("are checked by the pre-push gate", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts.verify).toContain("node scripts/ci/install-script-allowlist.mjs --check");
    expect(scripts["deps:install-scripts"]).toBe("node scripts/ci/install-script-allowlist.mjs");
  });
});

describe("workflow credentials and pins", () => {
  it("drop the job token from every checkout", () => {
    for (const { where, step } of everyStep()) {
      if (!step.uses?.startsWith("actions/checkout@")) continue;
      expect(step.with?.["persist-credentials"], where).toBe(false);
    }
  });

  it("pin every remote action to a full commit and name its tag", () => {
    for (const { where, step } of everyStep()) {
      if (!step.uses || step.uses.startsWith("./")) continue;
      expect(step.uses, where).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
    for (const { file, source } of workflows) {
      for (const line of source.split("\n")) {
        const uses = /uses: ([^.\s][^\s]*@[0-9a-f]{40})(.*)$/.exec(line);
        if (uses) expect(uses[2], `${file}: ${uses[1]}`).toMatch(/^ # v\d/);
      }
    }
  });

  it("push a refresh branch with a token that lives for one step", () => {
    for (const { file, source } of workflows) {
      for (const match of source.matchAll(/run: (.*--open-pr.*)$/gm)) {
        expect(match[1], file).toMatch(/^scripts\/ci\/with-git-token\.sh /);
      }
    }
  });

  it("keep the service-role key out of the digest until delivery is wired", () => {
    const digest = workflows.find((workflow) => workflow.file === "weekly-digest.yml");
    expect(digest).toBeDefined();
    expect(digest?.source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{/);
  });
});

// The free plan runs 5 macOS jobs at once and about 20 Linux jobs, so a job
// stays on macOS only with a reason. Each one here runs Playwright.
const MACOS_JOBS: Record<string, string> = {
  // Proved on macOS glyph widths. On ubuntu-latest (16 Oct 2026) four layout
  // specs failed on a measured edge and the full suite failed 19 more tests.
  "e2e.yml / layout-pins-1": "layout measured on macOS glyph widths",
  "e2e.yml / layout-pins-2": "layout measured on macOS glyph widths",
  "e2e.yml / layout-pins-3": "layout measured on macOS glyph widths",
  "e2e.yml / full-suite": "layout measured on macOS glyph widths",
  "e2e.yml / full-suite-gl": "layout measured on macOS glyph widths",
  // Its route budgets are figures measured on macOS. A Linux figure is a
  // different measurement, not the same ceiling.
  "performance.yml / performance-budget": "budgets measured on macOS",
  "performance.yml / ux-lane-performance": "budgets measured on macOS",
  // One job per production deploy, never on the pull request path.
  "prod-smoke.yml / smoke": "proved on macOS, one run per deploy",
};

describe("hosted runners", () => {
  it("runs every job on ubuntu-latest except the closed macOS list", () => {
    const seen: string[] = [];
    for (const { file, parsed } of workflows) {
      for (const [jobId, job] of Object.entries(parsed.jobs)) {
        const where = `${file} / ${jobId}`;
        if (job["runs-on"] === "macos-latest") seen.push(where);
        expect(job["runs-on"], where).toBe(where in MACOS_JOBS ? "macos-latest" : "ubuntu-latest");
      }
    }
    expect(seen.sort()).toEqual(Object.keys(MACOS_JOBS).sort());
  });

  it("keeps the macOS list to Playwright jobs", () => {
    for (const where of Object.keys(MACOS_JOBS)) {
      const [file, jobId] = where.split(" / ");
      const job = workflows.find((workflow) => workflow.file === file)?.parsed.jobs[defined(jobId)];
      expect(
        job?.steps.some((step) => typeof step.run === "string" && /\bplaywright test\b/.test(step.run)),
        where,
      ).toBe(true);
    }
  });

  it("gives a fork pull request no repository secret", () => {
    for (const { file, parsed } of workflows) {
      if (!triggers(parsed).some((trigger) => trigger.startsWith("pull_request"))) continue;
      for (const expression of expressions(parsed)) {
        expect(expression, file).not.toMatch(/\bsecrets\b/);
      }
    }
  });

  it("finds the secrets context in a parsed workflow expression", () => {
    const workflow = parse(
      [
        "on: pull_request",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      # secrets.IGNORED is a comment",
        "      - run: echo done",
        "        env:",
        "          KEY: ${{ toJSON(secrets) }}",
        "          OTHER: ${{ secrets['X'] }}",
      ].join("\n"),
    );
    expect(expressions(workflow).filter((expression) => /\bsecrets\b/.test(expression))).toHaveLength(2);
  });
});
