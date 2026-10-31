import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  ReleaseRefusal,
  parseDeploymentUrl,
  pickDispatchedRun,
  releaseProduction,
  type ReleaseDeps,
} from "@/scripts/lib/releaseProduction.mjs";

const ROOT = path.resolve(__dirname, "..");
const SHA = "a".repeat(40);

type SmokeStep = { id?: string; env?: Record<string, string>; run?: string };

/** The workflow's "bound" step, as GitHub reads it. */
function boundStep(): SmokeStep {
  const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/prod-smoke.yml"), "utf8"));
  const step = (workflow.jobs.smoke.steps as SmokeStep[]).find((candidate) => candidate.id === "bound");
  if (!step?.run) throw new Error("prod-smoke.yml has no bound step");
  return step;
}

/**
 * Runs the bound step's script the way a GitHub runner does, with curl and jq
 * replaced so /api/version answers `live` on the production origin and `mine`
 * on a deployment URL.
 */
function runBoundStep(input: { live: string; expected?: string; deploymentUrl?: string; mine?: string }) {
  const bin = mkdtempSync(path.join(tmpdir(), "prod-smoke-bound-"));
  writeFileSync(
    path.join(bin, "curl"),
    [
      "#!/bin/sh",
      'for arg in "$@"; do url="$arg"; done',
      'case "$url" in https://pubmaxxing.com/*) id="$FAKE_LIVE" ;; *) id="$FAKE_MINE" ;; esac',
      'printf \'{"deploymentId":"%s"}\' "$id"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(bin, "jq"),
    [
      `#!${process.execPath}`,
      'let body = "";',
      'process.stdin.on("data", (chunk) => { body += chunk; });',
      'process.stdin.on("end", () => { process.stdout.write(`${JSON.parse(body).deploymentId ?? ""}\\n`); });',
      "",
    ].join("\n"),
  );
  chmodSync(path.join(bin, "curl"), 0o755);
  chmodSync(path.join(bin, "jq"), 0o755);
  const outputFile = path.join(bin, "github-output");
  writeFileSync(outputFile, "");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", boundStep().run as string], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: outputFile,
      FAKE_LIVE: input.live,
      FAKE_MINE: input.mine ?? "",
      DEPLOYMENT_URL: input.deploymentUrl ?? "",
      EXPECTED_DEPLOYMENT_ID: input.expected ?? "",
    },
  });
  const output = readFileSync(outputFile, "utf8");
  rmSync(bin, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, output };
}

type Call = { command: string; args: string[] };

function harness(overrides: Partial<Record<string, { status: number; stdout: string }>> = {}) {
  const calls: Call[] = [];
  const said: string[] = [];
  let clock = 1_000_000;
  const liveIds = ["dpl_old", "dpl_new"];
  const run: ReleaseDeps["run"] = async (command, args) => {
    calls.push({ command, args });
    const key = `${command} ${args.slice(0, 2).join(" ")}`;
    const override = Object.entries(overrides).find(([prefix]) => key.startsWith(prefix));
    if (override?.[1]) return override[1];
    if (command === "git" && args[0] === "status") return { status: 0, stdout: "" };
    if (command === "git" && args[0] === "fetch") return { status: 0, stdout: "" };
    if (command === "git" && args[0] === "rev-parse") return { status: 0, stdout: `${SHA}\n` };
    if (command === "node") return { status: 0, stdout: "Production: https://pubmax-abc.vercel.app\n" };
    if (command === "gh" && args[0] === "run" && args[1] === "list") {
      return {
        status: 0,
        stdout: JSON.stringify([{
          databaseId: 77, headSha: SHA, createdAt: new Date(clock).toISOString(), displayTitle: "Production smoke dpl_new",
        }]),
      };
    }
    return { status: 0, stdout: "" };
  };
  const deps: ReleaseDeps = {
    run,
    deploymentIdAt: async (origin) =>
      origin === "https://pubmax-abc.vercel.app" ? "dpl_new" : (liveIds.shift() ?? "dpl_new"),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    say: (line) => said.push(line),
  };
  return { deps, calls, said };
}

function environmentHarness({ deploymentId = "dpl_new", promoteStatus = 0 }: {
  deploymentId?: string | null;
  promoteStatus?: number;
} = {}) {
  const fixture = harness({ "vercel promote": { status: promoteStatus, stdout: "" } });
  const { deps } = fixture;
  const events: string[] = [];
  const environments = {
    preview: {
      NEXT_PUBLIC_SUPABASE_URL: "https://preview-fixture.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-preview-key",
    },
    production: {
      CRON_SECRET: "fixture-production-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://production-fixture.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-production-key",
    },
  };
  let artifact: { buildEnv: Record<string, string>; runtimeEnv: Record<string, string> } | null = null;
  let domainDeploymentId = "dpl_old";
  let liveReads = 0;
  const run = deps.run;
  deps.preflight = [{ name: "migration ledger", run: async () => { events.push("preflight"); } }];
  deps.run = async (command, args, options) => {
    const result = await run(command, args, options);
    if (command === "node" && args[0] === "scripts/deploy-vercel.mjs") {
      // Model the documented deploy consumer, not the release helper's source.
      // https://vercel.com/docs/cli/deploy#prod
      // https://vercel.com/docs/cli/deploy#skip-domain
      events.push("deploy");
      const targetIndex = args.indexOf("--target");
      const target = args.includes("--prod") ? "production"
        : args.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
          ?? (targetIndex >= 0 ? args[targetIndex + 1] : "preview");
      const env = target === "production" ? environments.production : environments.preview;
      artifact = { buildEnv: { ...env }, runtimeEnv: { ...env } };
      if (target === "production" && !args.includes("--skip-domain")) domainDeploymentId = "dpl_new";
    }
    if (command === "vercel" && args[0] === "promote") {
      events.push("promote");
      expect(args[1]).toBe("https://pubmax-abc.vercel.app");
      // Promotion assigns domains to the existing artifact. It does not select new values.
      if (result.status === 0) domainDeploymentId = "dpl_new";
    }
    if (command === "gh" && args[0] === "workflow") events.push("dispatch");
    if (command === "gh" && args[0] === "run" && args[1] === "watch") events.push("watch");
    return result;
  };
  deps.deploymentIdAt = async (origin) => {
    if (origin === "https://pubmax-abc.vercel.app") {
      events.push("identity");
      expect(domainDeploymentId).toBe("dpl_old");
      return deploymentId;
    }
    expect(origin).toBe("https://pubmaxxing.com");
    events.push("live");
    return liveReads++ === 0 ? "dpl_old" : domainDeploymentId;
  };
  return { ...fixture, events, artifact: () => artifact, domainDeploymentId: () => domainDeploymentId };
}

describe("parseDeploymentUrl", () => {
  it("selects one staged result and ignores later alias and help URLs", () => {
    expect(
      parseDeploymentUrl(
        "Inspect: https://vercel.com/x\n\u001b[32m▲ Production\u001b[0m  https://two-abc.vercel.app [1m]\n" +
        "▲ Aliased  https://one.vercel.app\nTry vercel curl https://one.vercel.app\n",
      ),
    ).toBe("https://two-abc.vercel.app");
    expect(parseDeploymentUrl("https://two-abc.vercel.app\n")).toBe("https://two-abc.vercel.app");
    expect(parseDeploymentUrl("Production: https://two-abc.vercel.app\nhttps://two-abc.vercel.app\n"))
      .toBe("https://two-abc.vercel.app");
    expect(parseDeploymentUrl("https://one.vercel.app\nhttps://two-abc.vercel.app\n")).toBeNull();
    expect(parseDeploymentUrl("Production: https://one.vercel.app\nProduction: https://two-abc.vercel.app\n"))
      .toBeNull();
    expect(parseDeploymentUrl("▲ Aliased https://one.vercel.app\n")).toBeNull();
    expect(parseDeploymentUrl("Try vercel curl https://one.vercel.app\n")).toBeNull();
    expect(parseDeploymentUrl("nothing here")).toBeNull();
  });
});

describe("pickDispatchedRun", () => {
  const dispatchedAtMs = Date.parse("2026-10-06T10:00:00Z");
  it("requires the released deployment, commit and dispatch time", () => {
    const runs = [
      { databaseId: 1, headSha: "b".repeat(40), createdAt: "2026-10-06T10:00:30Z", displayTitle: "Production smoke dpl_a" },
      { databaseId: 2, headSha: SHA, createdAt: "2026-10-06T09:00:00Z", displayTitle: "Production smoke dpl_a" },
      { databaseId: 3, headSha: SHA, createdAt: "2026-10-06T10:00:10Z", displayTitle: "Production smoke dpl_a" },
      { databaseId: 4, headSha: SHA, createdAt: "2026-10-06T10:00:20Z", displayTitle: "Production smoke dpl_b" },
      { databaseId: 5, headSha: SHA, createdAt: "2026-10-06T10:00:30Z", displayTitle: "Production smoke dpl_a_extra" },
      { databaseId: 6, headSha: SHA, createdAt: "2026-10-06T10:00:40Z" },
    ];
    const input = { sha: SHA, dispatchedAtMs, deploymentId: "dpl_a" };
    expect(pickDispatchedRun(runs, input)?.databaseId).toBe(3);
    expect(pickDispatchedRun(runs.filter((run) => run.databaseId !== 3), input)).toBeNull();
  });
});

describe("releaseProduction", () => {
  it("keeps the uploaded deployment bound when a project alias moves before promotion", async () => {
    const immutableUrl = "https://pubmax-abc.vercel.app";
    const projectAlias = "https://pubmax-project.vercel.app";
    const fixture = harness({
      "node scripts/deploy-vercel.mjs": {
        status: 0,
        stdout: `▲ Production      ${immutableUrl}\n▲ Aliased         ${projectAlias}\n`,
      },
    });
    const events: string[] = [];
    const canonicalIds = ["dpl_old", "dpl_new"];
    let aliasDeploymentId = "dpl_old";
    const { deps } = fixture;
    const run = deps.run;
    const sleep = deps.sleep;
    deps.preflight = [{ name: "migration ledger", run: async () => { events.push("preflight"); } }];
    deps.run = async (command, args, options) => {
      const result = await run(command, args, options);
      if (command === "node" && args[0] === "scripts/deploy-vercel.mjs") events.push("deploy");
      if (command === "vercel" && args[0] === "promote") {
        // The provider can move the alias after its earlier identity lookup.
        aliasDeploymentId = "dpl_new";
        const promotedId = args[1] === immutableUrl ? "dpl_new" : aliasDeploymentId;
        events.push(`promote:${args[1]}:${promotedId}`);
      }
      if (command === "gh" && args[0] === "workflow") events.push("dispatch");
      if (command === "gh" && args[0] === "run" && args[1] === "watch") events.push("watch");
      return result;
    };
    deps.deploymentIdAt = async (origin) => {
      if (origin === immutableUrl) {
        events.push("verify:immutable:dpl_new");
        return "dpl_new";
      }
      if (origin === projectAlias) {
        events.push(`verify:alias:${aliasDeploymentId}`);
        return aliasDeploymentId;
      }
      expect(origin).toBe("https://pubmaxxing.com");
      const id = canonicalIds.shift() ?? "dpl_new";
      events.push(`live:${id}`);
      return id;
    };
    deps.sleep = async (ms) => {
      events.push("wait");
      await sleep(ms);
    };

    const receipt = await releaseProduction(deps, { pollMs: 10 });

    expect({ events, receipt }).toEqual({
      events: [
        "preflight", "deploy", "verify:immutable:dpl_new",
        `promote:${immutableUrl}:dpl_new`, "live:dpl_old", "wait", "live:dpl_new", "dispatch", "watch",
      ],
      receipt: { sha: SHA, deploymentId: "dpl_new", deploymentUrl: immutableUrl, smokeRunId: 77 },
    });
  });

  it("stages production values without moving domains before identity verification and promotion", async () => {
    const fixture = environmentHarness();
    const result = await releaseProduction(fixture.deps, { pollMs: 10 });
    const expectedEnv = {
      CRON_SECRET: "fixture-production-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://production-fixture.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-production-key",
    };
    expect(fixture.artifact()).toEqual({ buildEnv: expectedEnv, runtimeEnv: expectedEnv });
    expect(fixture.domainDeploymentId()).toBe("dpl_new");
    expect(fixture.events).toEqual(["preflight", "deploy", "identity", "promote", "live", "live", "dispatch", "watch"]);
    expect(result).toEqual({
      sha: SHA, deploymentId: "dpl_new", deploymentUrl: "https://pubmax-abc.vercel.app", smokeRunId: 77,
    });
  });

  it("keeps domains unchanged when the staged production deployment has no identity", async () => {
    const fixture = environmentHarness({ deploymentId: null });
    await expect(releaseProduction(fixture.deps)).rejects.toThrow(/named no deployment/);
    expect(fixture.domainDeploymentId()).toBe("dpl_old");
    expect(fixture.events).toEqual(["preflight", "deploy", "identity"]);
  });

  it("keeps domains unchanged and does not dispatch smoke when promotion fails", async () => {
    const fixture = environmentHarness({ promoteStatus: 1 });
    await expect(releaseProduction(fixture.deps)).rejects.toThrow(/promote failed/);
    expect(fixture.domainDeploymentId()).toBe("dpl_old");
    expect(fixture.events).toEqual(["preflight", "deploy", "identity", "promote"]);
  });

  it("refuses a failed migration preflight before any upload or domain movement", async () => {
    const fixture = environmentHarness();
    fixture.deps.preflight = [{
      name: "migration ledger",
      run: async () => { throw new ReleaseRefusal("Production lacks a migration."); },
    }];
    await expect(releaseProduction(fixture.deps)).rejects.toThrow(/lacks a migration/);
    expect(fixture.artifact()).toBeNull();
    expect(fixture.domainDeploymentId()).toBe("dpl_old");
    expect(fixture.events).toEqual([]);
    expect(fixture.calls.every((call) => call.command === "git")).toBe(true);
  });

  it("deploys, promotes, waits for the live origin, then dispatches and watches the smoke run", async () => {
    const { deps, calls } = harness();
    const result = await releaseProduction(deps, { pollMs: 10 });
    expect(result).toMatchObject({ sha: SHA, deploymentId: "dpl_new", smokeRunId: 77 });
    const order = calls.map((call) => `${call.command} ${call.args.slice(0, 2).join(" ")}`);
    const at = (prefix: string) => order.findIndex((entry) => entry.startsWith(prefix));
    expect(at("node scripts/deploy-vercel.mjs")).toBeGreaterThan(at("git fetch"));
    expect(at("vercel promote")).toBeGreaterThan(at("node scripts/deploy-vercel.mjs"));
    expect(at("gh workflow run")).toBeGreaterThan(at("vercel promote"));
    expect(at("gh run watch")).toBeGreaterThan(at("gh workflow run"));
    expect(calls.find((call) => call.args[0] === "workflow")?.args).toEqual([
      "workflow", "run", "prod-smoke.yml", "--repo", "Singularityszn/pubmax", "--ref", "main",
      "-f", "deployment_id=dpl_new",
    ]);
    expect(calls.find((call) => call.args[0] === "run" && call.args[1] === "watch")?.args).toContain("--exit-status");
  });

  it("refuses a dirty tree before it uploads anything", async () => {
    const { deps, calls } = harness({ "git status": { status: 0, stdout: " M lib/a.ts\n" } });
    await expect(releaseProduction(deps)).rejects.toThrow(/dirty/);
    expect(calls.some((call) => call.command === "node")).toBe(false);
  });

  it("refuses a HEAD that is not the tip of main", async () => {
    const { deps, calls } = harness();
    const base = deps.run;
    deps.run = async (command, args, options) =>
      command === "git" && args[1] === "origin/main"
        ? { status: 0, stdout: `${"c".repeat(40)}\n` }
        : base(command, args, options);
    await expect(releaseProduction(deps)).rejects.toThrow(/not origin\/main/);
    expect(calls.some((call) => call.command === "node")).toBe(false);
  });

  it("does not promote when the deploy fails or names no deployment", async () => {
    const failed = harness({ "node scripts/deploy-vercel.mjs": { status: 1, stdout: "" } });
    await expect(releaseProduction(failed.deps)).rejects.toThrow(/nothing was promoted/);
    expect(failed.calls.some((call) => call.command === "vercel")).toBe(false);

    const silent = harness({ "node scripts/deploy-vercel.mjs": { status: 0, stdout: "built" } });
    await expect(releaseProduction(silent.deps)).rejects.toThrow(/no deployment URL/);
  });

  it("fails when the live origin never serves the deployment", async () => {
    const { deps } = harness();
    deps.deploymentIdAt = async (origin) => (origin.includes("vercel.app") ? "dpl_new" : "dpl_old");
    await expect(releaseProduction(deps, { liveTimeoutMs: 50, pollMs: 10 })).rejects.toThrow(/still serves dpl_old/);
  });

  it("fails the release when the smoke suite fails", async () => {
    const { deps } = harness({ "gh run watch": { status: 1, stdout: "" } });
    await expect(releaseProduction(deps, { pollMs: 10 })).rejects.toBeInstanceOf(ReleaseRefusal);
    await expect(releaseProduction(harness({ "gh run watch": { status: 1, stdout: "" } }).deps, { pollMs: 10 })).rejects.toThrow(
      /smoke suite failed/,
    );
  });

  it("reports the released deployment unverified when A is replaced by B before the job starts", async () => {
    const { deps, calls, said } = harness();
    let dispatched = false;
    let live = "dpl_old";
    const base = deps.run;
    deps.run = async (command, args, options) => {
      if (command === "vercel" && args[0] === "promote") live = "dpl_new";
      if (command === "gh" && args[0] === "workflow") {
        dispatched = true;
        // Another release promotes B after A's dispatch and before its job starts.
        live = "dpl_b";
      }
      if (command === "gh" && args[0] === "run" && args[1] === "list") {
        calls.push({ command, args });
        return { status: 0, stdout: JSON.stringify([
          { databaseId: 77, headSha: SHA, createdAt: new Date(deps.now()).toISOString(), displayTitle: "Production smoke dpl_new" },
          { databaseId: 88, headSha: SHA, createdAt: new Date(deps.now() + 1).toISOString(), displayTitle: "Production smoke dpl_b" },
        ]) };
      }
      if (command === "gh" && args[0] === "run" && args[1] === "watch") {
        const input = calls.find((call) => call.args[0] === "workflow")?.args.find((arg) => arg.startsWith("deployment_id="));
        const expected = args[2] === "88" ? "dpl_b" : input?.slice("deployment_id=".length);
        const job = runBoundStep({ live, expected });
        calls.push({ command, args });
        return { status: job.status ?? 1, stdout: job.stdout };
      }
      return base(command, args, options);
    };
    deps.deploymentIdAt = async (origin) => (origin === "https://pubmax-abc.vercel.app" ? "dpl_new" : live);

    await expect(releaseProduction(deps, { pollMs: 10 })).rejects.toThrow(
      "https://pubmaxxing.com now serves dpl_b, not dpl_new. Smoke run 77 did not test the released deployment, so dpl_new is unverified.",
    );
    expect(dispatched).toBe(true);
    expect(calls.find((call) => call.args[1] === "watch")?.args[2]).toBe("77");
    expect(said.some((line) => /smoke suite passed/.test(line))).toBe(false);
  });

  it("accepts its own successful run when another deployment has a newer run", async () => {
    const { deps, calls } = harness({ "gh run list": { status: 0, stdout: JSON.stringify([
      { databaseId: 77, headSha: SHA, createdAt: new Date(1_000_010).toISOString(), displayTitle: "Production smoke dpl_new" },
      { databaseId: 88, headSha: SHA, createdAt: new Date(1_000_011).toISOString(), displayTitle: "Production smoke dpl_b" },
    ]) } });
    await expect(releaseProduction(deps, { pollMs: 10 })).resolves.toMatchObject({ smokeRunId: 77 });
    expect(calls.find((call) => call.args[1] === "watch")?.args[2]).toBe("77");
  });

  it("reports an unverified release when only another deployment's run appears", async () => {
    const { deps, calls } = harness({ "gh run list": { status: 0, stdout: JSON.stringify([
      { databaseId: 88, headSha: SHA, createdAt: new Date(1_000_010).toISOString(), displayTitle: "Production smoke dpl_b" },
    ]) } });
    await expect(releaseProduction(deps, { pollMs: 10, runLookupTimeoutMs: 20 })).rejects.toThrow(/live and unverified/);
    expect(calls.some((call) => call.args[1] === "watch")).toBe(false);
  });
});

describe("prod-smoke.yml binds a dispatched run to the released deployment", () => {
  it("declares the input and hands it to the check before the suite", () => {
    const workflow = parse(readFileSync(path.join(ROOT, ".github/workflows/prod-smoke.yml"), "utf8"));
    expect(workflow.on.workflow_dispatch.inputs.deployment_id).toMatchObject({ required: false, type: "string" });
    expect(workflow["run-name"]).toBe("Production smoke ${{ inputs.deployment_id || github.run_id }}");
    expect(boundStep().env?.EXPECTED_DEPLOYMENT_ID).toBe("${{ inputs.deployment_id }}");
  });

  it("runs the suite when production serves the named deployment, and keeps it as the after-check baseline", () => {
    const job = runBoundStep({ live: "dpl_a", expected: "dpl_a" });
    expect(job.status).toBe(0);
    expect(job.output).toBe("live=dpl_a\nrun=true\n");
  });

  it("fails, never skips, when production serves another deployment", () => {
    const job = runBoundStep({ live: "dpl_b", expected: "dpl_a" });
    expect(job.status).toBe(1);
    expect(job.stdout).toContain("not the released deployment dpl_a");
    expect(job.stdout).toContain("unverified");
    expect(job.output).not.toContain("run=");
  });

  it("refuses a deployment id that is not one", () => {
    const job = runBoundStep({ live: "dpl_a", expected: "dpl_a;rm" });
    expect(job.status).toBe(1);
    expect(job.stdout).toContain("Unexpected deployment id");
  });

  it("keeps the deployment_status and bare dispatch paths as they were", () => {
    expect(runBoundStep({ live: "dpl_a" }).output).toBe("live=dpl_a\nrun=true\n");
    const newer = runBoundStep({ live: "dpl_b", mine: "dpl_a", deploymentUrl: "https://pubmax-a.vercel.app" });
    expect(newer.status).toBe(0);
    expect(newer.output).toBe("live=dpl_b\nrun=false\n");
  });
});

describe("the npm script", () => {
  it("is the one release command and names the entry script", () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["release:prod"]).toBe("node scripts/release-production.mjs");
  });
});
