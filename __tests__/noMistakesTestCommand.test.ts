// THE NO-MISTAKES TEST STEP RUNS THE MERGE BAR ITSELF, NOT THROUGH AN AGENT.
//
// With no `commands.test` in `.no-mistakes.yaml`, the pipeline handed the whole
// Test step to one agent turn capped at 30 minutes, and on 12 and 13 September
// 2026 that turn timed out twice. The repository command now runs first, as a
// plain shell baseline with no agent cap, so the evidence agent that follows
// never has to walk the suite itself.
//
// TWO facts about the tool shape this fence. (1) A run worktree holds tracked
// files only, so `node_modules` is absent until `commands.prepare` installs it.
// (2) no-mistakes reads `commands.*` ONLY from the `origin/main` copy of the
// file, so a branch that edits this config is still tested by the old one.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = process.cwd();

type RepoConfig = { commands?: { prepare?: string; test?: string } };

function repoConfig(): RepoConfig {
  return parse(readFileSync(join(ROOT, ".no-mistakes.yaml"), "utf8")) ?? {};
}

function packageScripts(): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
}

// Expands every `npm run <script>` into the text it runs, so the fence judges
// what the step executes rather than the name it was given.
function expand(command: string, scripts: Record<string, string>, seen: string[] = []): string {
  return command.replace(/npm run ([\w:.-]+)/g, (_, name: string) => {
    if (seen.includes(name)) throw new Error(`script cycle through ${name}`);
    const body = scripts[name];
    if (body === undefined) throw new Error(`commands.test names a missing script: ${name}`);
    return expand(body, scripts, [...seen, name]);
  });
}

describe("the no-mistakes repository test command", () => {
  it("installs dependencies from the lockfile before a configured command", () => {
    const prepare = repoConfig().commands?.prepare ?? "";
    expect(prepare.trim().split(/\s+/).slice(0, 2)).toEqual(["npm", "ci"]);
  });

  it("runs the pre-push merge bar", () => {
    expect(repoConfig().commands?.test?.trim()).toBe("npm run verify");
  });

  it("reaches the unit suite and never the browser suite", () => {
    const test = repoConfig().commands?.test ?? "";
    const expanded = expand(test, packageScripts());

    expect(expanded).toContain("vitest run");
    // The browser suite runs in the merge bar's own e2e workflow.
    expect(expanded).not.toMatch(/playwright/);
  });
});
