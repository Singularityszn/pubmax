// A PUBLIC REPO DOES NOT RUN CI ON A PERSONAL MACHINE.
//
// Visual Playwright jobs use GitHub-hosted macos-latest. The isolated real
// authentication job uses ubuntu-latest for Docker. Every other job
// uses ubuntu-latest. Pull request workflows do not reference the secrets
// context, so a fork cannot read a repository secret. docs/CI_RUNBOOK.md
// is the runbook.
//
//   1. no dependency runs an install script unless the allowlist says so;
//   2. no pre/post npm hook exists for `ignore-scripts` to skip in silence;
//   3. every checkout drops its credential, and every remote action is pinned
//      to a commit;
//   4. visual Playwright uses macOS and the isolated real-auth job uses Linux,
//      and a pull request workflow has no secrets.

import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

function shellCommands(source: string): string[][] {
  return JSON.parse(execFileSync("python3", ["-c", String.raw`
import json, re, shlex, sys
lines = []
terminator = None
for line in sys.stdin.read().splitlines():
    if terminator is not None:
        if line.strip() == terminator:
            terminator = None
        continue
    lines.append(line)
    heredoc = re.search(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1", line)
    if heredoc:
        terminator = heredoc.group(2)
lexer = shlex.shlex("\n".join(lines), posix=True, punctuation_chars=";&|()<>\n")
lexer.whitespace = " \t\r"
lexer.commenters = "#"
commands, words = [], []
for word in lexer:
    if word and all(char in ";&|()\n" for char in word):
        if words:
            commands.append(words)
            words = []
    elif not words and re.match(r"^[A-Za-z_]\w*=", word):
        continue
    else:
        words.append(word)
if words:
    commands.append(words)
print(json.dumps(commands))
`], { input: source, encoding: "utf8" })) as string[][];
}

function isPlaywrightTest(command: string[]) {
  return command[0] === "npx" && command[1] === "playwright" && command[2] === "test";
}

function expectIsolatedAuthCommands(commands: string[][]) {
  expect(commands.some((command) => isPlaywrightTest(command) && command.includes("--config=playwright.authenticated.config.ts"))).toBe(true);
  expect(commands.some((command) => command[0] === "supabase" && command[1] === "start"
    && command.indexOf("--workdir") >= 2 && Boolean(command[command.indexOf("--workdir") + 1]))).toBe(true);
}

describe("hosted runners", () => {
  it("runs visual Playwright jobs on macOS and isolated real auth on Linux", () => {
    for (const { file, parsed } of workflows) {
      for (const [jobId, job] of Object.entries(parsed.jobs)) {
        const commands = job.steps.flatMap((step) => step.run ? shellCommands(step.run) : []);
        const launchesPlaywright = commands.some(isPlaywrightTest);
        const isolatedRealAuth = file === "e2e.yml" && jobId === "authenticated-recovery";
        expect(job["runs-on"], `${file} / ${jobId}`).toBe(
          launchesPlaywright && !isolatedRealAuth ? "macos-latest" : "ubuntu-latest",
        );
        if (isolatedRealAuth) {
          expectIsolatedAuthCommands(commands);
        }
      }
    }
  });

  it("rejects comments, quoted command text and heredoc bodies as executable authentication setup", () => {
    const commands = shellCommands([
      "# npx playwright test --config=playwright.authenticated.config.ts",
      "echo 'npx playwright test --config=playwright.authenticated.config.ts'",
      "printf '%s' 'supabase start --workdir /tmp/project'",
      "cat <<'TEXT'",
      "supabase start --workdir /tmp/project",
      "npx playwright test --config=playwright.authenticated.config.ts",
      "TEXT",
    ].join("\n"));
    expect(commands.some(isPlaywrightTest)).toBe(false);
    expect(() => expectIsolatedAuthCommands(commands)).toThrow();
    expect(() => expectIsolatedAuthCommands(shellCommands("npx playwright test --config=playwright.authenticated.config.ts\nsupabase start --workdir"))).toThrow();
    expectIsolatedAuthCommands(shellCommands("npx 'playwright' test '--config=playwright.authenticated.config.ts' && supabase start --workdir '$RUNNER_TEMP/project'"));
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
