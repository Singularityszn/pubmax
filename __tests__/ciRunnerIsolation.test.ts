// THE PR RUNNERS RUN UNTRUSTED CODE, SO NOTHING ON THEM MAY BE WORTH STEALING.
//
// The self-hosted pubmax-mac runners execute every pull request branch and
// every dependency its lockfile names. The week security review (H1, L17, L19)
// found them running as the Mac's login user, with install scripts on, a write
// token persisted in `.git/config` by the refresh jobs, and a service-role key
// referenced by a job that never used it. docs/CI_RUNBOOK.md, section
// 'Dedicated runner users', is the machine half. This file holds the
// repository half to the tree:
//
//   1. no dependency runs an install script unless the allowlist says so;
//   2. no pre/post npm hook exists for `ignore-scripts` to skip in silence;
//   3. every checkout drops its credential, and every remote action is pinned
//      to a commit;
//   4. a job holding a write token or a secret runs on its own runner label,
//      and a pull request job never does;
//   5. every job refuses to run as the console user before it runs anything
//      from the checkout.

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

const ROOT = process.cwd();
const PR_LABEL = "pubmax-mac";
const PRIVILEGED_LABEL = "pubmax-mac-refresh";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  "runs-on": string[];
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

describe("runner labels", () => {
  function isPrivileged(workflow: Workflow, job: Job, source: string): boolean {
    const permissions = job.permissions ?? workflow.permissions ?? {};
    const writes = Object.values(permissions).some((level) => level === "write");
    const secrets = [...source.matchAll(/secrets\.([A-Z0-9_]+)/g)].some(([, name]) => name !== "GITHUB_TOKEN");
    return writes || secrets;
  }

  it("put every job that holds a write token or a secret on the privileged runner, and only those", () => {
    for (const { file, source, parsed } of workflows) {
      for (const [jobId, job] of Object.entries(parsed.jobs)) {
        const label = isPrivileged(parsed, job, source) ? PRIVILEGED_LABEL : PR_LABEL;
        expect(job["runs-on"], `${file} / ${jobId}`).toEqual(["self-hosted", label]);
      }
    }
  });

  it("never run pull request code on the privileged runner", () => {
    for (const { file, parsed } of workflows) {
      if (!triggers(parsed).some((trigger) => trigger.startsWith("pull_request"))) continue;
      for (const [jobId, job] of Object.entries(parsed.jobs)) {
        expect(job["runs-on"], `${file} / ${jobId}`).not.toContain(PRIVILEGED_LABEL);
      }
    }
  });
});

describe("the dedicated runner setup", () => {
  it("registers a runner only from that user's own shell", () => {
    const script = readFileSync(join(ROOT, "scripts/ci/setup-dedicated-runner-user.sh"), "utf8");
    const registration = script.split('for spec in "${RUNNERS[@]}"')[1];
    expect(registration, "registration loop").toBeDefined();
    // Retired runners live in the console home, where this user can cd. A new
    // runner lives in a 700 home this user cannot enter, so the registration
    // loop has no console-user cd at all.
    expect(registration).not.toMatch(/\(cd /);
    expect(registration).toContain(
      `"\${as_user[@]}" sh -c 'cd "$1" && shift && exec ./config.sh "$@"' sh "$dir"`,
    );
  });

  it("copies runsvc.sh to the runner root and restarts a service that is already loaded", () => {
    const script = readFileSync(join(ROOT, "scripts/ci/setup-dedicated-runner-user.sh"), "utf8");
    const registration = script.split('for spec in "${RUNNERS[@]}"')[1];
    expect(registration).toContain(`sudo -u "$user" cp "$dir/bin/runsvc.sh" "$dir/runsvc.sh"`);
    expect(registration).toContain(`sudo -u "$user" chmod u+x "$dir/runsvc.sh"`);
    const bootstrapAt = registration.indexOf('launchctl bootstrap system "$plist"');
    const kickstartAt = registration.lastIndexOf('launchctl kickstart -k "system/${service}"');
    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(kickstartAt).toBeGreaterThan(bootstrapAt);
  });

  it("fails when a runner is still offline after a minute", () => {
    const script = readFileSync(join(ROOT, "scripts/ci/setup-dedicated-runner-user.sh"), "utf8");
    const prove = script.split('say "Prove it"')[1];
    expect(prove).toBeDefined();
    expect(prove).toContain("SECONDS + 60");
    expect(prove).toContain('"$status" != "online"');
    expect(prove).toContain("runners not online within 60s");
  });
});

describe("the runner identity check", () => {
  it("is the first thing every job runs after its checkout", () => {
    for (const { file, parsed } of workflows) {
      for (const [jobId, job] of Object.entries(parsed.jobs)) {
        // A step before the checkout cannot run branch code, because there is
        // no branch on disk yet (performance.yml records its start time there).
        const checkout = job.steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
        expect(checkout, `${file} / ${jobId} checks out`).toBeGreaterThanOrEqual(0);
        expect(job.steps[checkout + 1], `${file} / ${jobId}`).toEqual({
          name: "Refuse the console user",
          run: "bash scripts/ci/assert-runner-identity.sh",
        });
      }
    }
  });

  it("fails as the console user, as root, as an admin, and when the console home is readable", () => {
    const check = readFileSync(join(ROOT, "scripts/ci/assert-runner-identity.sh"), "utf8");
    expect(check).toContain('"$job_user" = "$console_user"');
    expect(check).toContain('"$job_user" = "root"');
    expect(check).toMatch(/grep -qx admin/);
    expect(check).toMatch(/ls "\$console_home"/);
  });
});
