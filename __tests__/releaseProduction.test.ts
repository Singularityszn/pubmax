import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ReleaseRefusal,
  parseDeploymentUrl,
  pickDispatchedRun,
  releaseProduction,
  type ReleaseDeps,
} from "@/scripts/lib/releaseProduction.mjs";

const ROOT = path.resolve(__dirname, "..");
const SHA = "a".repeat(40);

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
        stdout: JSON.stringify([{ databaseId: 77, headSha: SHA, createdAt: new Date(clock).toISOString() }]),
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
  it("takes the last deployment URL the CLI printed", () => {
    expect(
      parseDeploymentUrl("Inspect: https://vercel.com/x\nhttps://one.vercel.app\nhttps://two-abc.vercel.app\n"),
    ).toBe("https://two-abc.vercel.app");
    expect(parseDeploymentUrl("nothing here")).toBeNull();
  });
});

describe("pickDispatchedRun", () => {
  const dispatchedAtMs = Date.parse("2026-10-06T10:00:00Z");
  it("ignores a run on another commit or one older than the dispatch", () => {
    const runs = [
      { databaseId: 1, headSha: "b".repeat(40), createdAt: "2026-10-06T10:00:30Z" },
      { databaseId: 2, headSha: SHA, createdAt: "2026-10-06T09:00:00Z" },
      { databaseId: 3, headSha: SHA, createdAt: "2026-10-06T10:00:10Z" },
    ];
    expect(pickDispatchedRun(runs, { sha: SHA, dispatchedAtMs })?.databaseId).toBe(3);
    expect(pickDispatchedRun(runs.slice(0, 2), { sha: SHA, dispatchedAtMs })).toBeNull();
  });
});

describe("releaseProduction", () => {
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
});

describe("the npm script", () => {
  it("is the one release command and names the entry script", () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["release:prod"]).toBe("node scripts/release-production.mjs");
  });
});
