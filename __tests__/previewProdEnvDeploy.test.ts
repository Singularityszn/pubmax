import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LOCAL_DATA_REVISION,
  NO_DATA_REVISION_REFUSAL,
  environmentDataRevision,
  packBuildEnv,
  requireDataRevision,
  resolveDataRevision,
  revisionFromCommitSha,
} from "@/lib/dataRevision.mjs";
import {
  REFUSED_DEPLOY_FLAGS,
  classifyPulledEnv,
  deployEnvFlags,
  isPlatformOwnedName,
  parsePulledEnvFile,
  refusedFlagReason,
} from "@/scripts/lib/previewProdEnv.mjs";
import { vercelCommand } from "@/scripts/lib/vercelCli.mjs";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("a build names its own data revision", () => {
  it("takes the release environment's answer first", () => {
    expect(
      environmentDataRevision({ VERCEL_DEPLOYMENT_ID: "dpl_abc", GITHUB_SHA: "b".repeat(40) }),
    ).toBe("dpl_abc");
    expect(environmentDataRevision({ VERCEL_GIT_COMMIT_SHA: "  " })).toBeNull();
  });

  it("falls back to the working tree, shortened so a deployment id stays legal", () => {
    const sha = "949e0592b9ac6b8ee2b6b375fd5c686171791a30";
    expect(revisionFromCommitSha(sha)).toBe("949e0592b9ac");
    expect(revisionFromCommitSha(sha)?.length ?? 0).toBeLessThanOrEqual(32);
    expect(resolveDataRevision({}, { workingTreeSha: `${sha}\n` })).toBe("949e0592b9ac");
  });

  it("reads a branch name or an empty variable as no answer", () => {
    expect(revisionFromCommitSha("main")).toBeNull();
    expect(revisionFromCommitSha("")).toBeNull();
    expect(revisionFromCommitSha(undefined)).toBeNull();
  });

  it("refuses a production build that can name nothing, and only that one", () => {
    const sha = "949e0592b9ac6b8ee2b6b375fd5c686171791a30";
    expect(() => requireDataRevision({ NODE_ENV: "production" }, { workingTreeSha: null }))
      .toThrow(NO_DATA_REVISION_REFUSAL);
    expect(requireDataRevision({}, { workingTreeSha: null })).toBe(LOCAL_DATA_REVISION);
    expect(requireDataRevision({ NODE_ENV: "development" }, { workingTreeSha: sha })).toBe(
      LOCAL_DATA_REVISION,
    );
    expect(requireDataRevision({}, { workingTreeSha: sha })).toBe(LOCAL_DATA_REVISION);
    expect(requireDataRevision({ NODE_ENV: "production" }, { workingTreeSha: sha })).toBe(
      "949e0592b9ac",
    );
  });

  it("stamps a pack build from the working tree when NODE_ENV is still unset", () => {
    const sha = "949e0592b9ac6b8ee2b6b375fd5c686171791a30";
    expect(requireDataRevision(packBuildEnv({}), { workingTreeSha: sha })).toBe("949e0592b9ac");
    expect(
      requireDataRevision(packBuildEnv({ NODE_ENV: "development" }), { workingTreeSha: sha }),
    ).toBe(LOCAL_DATA_REVISION);
  });

  it("is the ONE rule: the build and its shard payloads read the same module", () => {
    expect(read("next.config.mjs")).toContain('from "./lib/dataRevision.mjs"');
    expect(read("scripts/lib/slimShards.mjs")).toContain('from "../../lib/dataRevision.mjs"');
    // A second copy of the order is how a build and its data drift apart.
    expect(read("next.config.mjs")).not.toContain("A deploy revision is required");
    expect(read("scripts/lib/slimShards.mjs")).not.toContain("A deploy revision is required");
  });

  it("names a real production build revision from this worktree", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    expect(requireDataRevision({ NODE_ENV: "production" }, { workingTreeSha: head })).toBe(
      head.slice(0, 12),
    );
  });
});

describe("what a production-environment preview may carry", () => {
  const PULLED = [
    "# Created by Vercel CLI",
    'NEXT_PUBLIC_SUPABASE_URL="[SENSITIVE]"',
    'NEXT_PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"',
    'SUPABASE_SERVICE_ROLE_KEY="[SENSITIVE]"',
    'SUPABASE_PUBLISHABLE_KEY="sb_publishable_live"',
    'VERCEL_ENV="production"',
    'VERCEL_GIT_COMMIT_SHA=""',
    'TURBO_CACHE="remote:rw"',
    'NX_DAEMON="false"',
    "",
  ].join("\n");

  it("reads the CLI's own file shape and skips what it cannot read", () => {
    expect(parsePulledEnvFile('A="one"\n# note\nbroken\n=2\nB=two\n')).toEqual([
      ["A", "one"],
      ["B", "two"],
    ]);
  });

  it("drops a [SENSITIVE] placeholder rather than inlining it into the bundle", () => {
    const { forwarded, sensitive } = classifyPulledEnv(PULLED);
    expect(forwarded.map(([name]) => name)).toEqual([
      "NEXT_PUBLIC_POSTHOG_HOST",
      "SUPABASE_PUBLISHABLE_KEY",
    ]);
    expect(sensitive).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(JSON.stringify(forwarded)).not.toContain("[SENSITIVE]");
  });

  it("leaves every platform-owned name to Vercel, VERCEL_ENV among them", () => {
    const { platform, forwarded } = classifyPulledEnv(PULLED);
    expect(platform).toContain("VERCEL_ENV");
    expect(platform).toContain("TURBO_CACHE");
    expect(platform).toContain("NX_DAEMON");
    expect(forwarded.map(([name]) => name)).not.toContain("VERCEL_ENV");
    expect(isPlatformOwnedName("VERCEL_OIDC_TOKEN")).toBe(true);
    expect(isPlatformOwnedName("SUPABASE_URL")).toBe(false);
  });

  it("carries each forwarded value to BOTH environments", () => {
    expect(deployEnvFlags([["NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com"]])).toEqual([
      "--build-env",
      "NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com",
      "--env",
      "NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com",
    ]);
  });
});

describe("the command that makes the preview", () => {
  it("refuses to promote and refuses a macOS prebuilt upload", () => {
    expect(refusedFlagReason(["--prod"])?.flag).toBe("--prod");
    expect(refusedFlagReason(["--prebuilt"])?.reason).toContain("sharp");
    expect(refusedFlagReason(["--target=preview"])).toBeNull();
    expect(Object.keys(REFUSED_DEPLOY_FLAGS)).toContain("--production");
  });

  it("runs one CLI, resolved in one place", () => {
    expect(vercelCommand(["deploy"], {})).toEqual({
      command: "npx",
      args: ["-y", "vercel@latest", "deploy"],
    });
    expect(vercelCommand(["deploy"], { PUBMAX_VERCEL_BIN: "/usr/local/bin/vercel" })).toEqual({
      command: "/usr/local/bin/vercel",
      args: ["deploy"],
    });
    expect(read("scripts/deploy-vercel.mjs")).toContain('from "./lib/vercelCli.mjs"');
  });

  it("is one npm script, and it deploys through the command that stamps the commit", () => {
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts["deploy:preview:prod-env"]).toBe("node scripts/deploy-preview-prod-env.mjs");
    const source = read("scripts/deploy-preview-prod-env.mjs");
    expect(source).toContain("deploy-vercel.mjs");
    expect(source).toContain("--environment=production");
    // Never a promotion, and never a prebuilt upload from this machine.
    expect(source).not.toContain('"--prod"');
    expect(source).not.toContain("--prebuilt\"");
  });

  it("prints names, never values", () => {
    const source = read("scripts/deploy-preview-prod-env.mjs");
    expect(source).toContain("forwarded.map(([name]) => name).join");
    expect(source).not.toMatch(/console\.log\([^)]*forwarded\[0\]\[1\]/);
  });

  it("is documented with the exact command", () => {
    const runbook = read("docs/DEPLOYMENT.md");
    expect(runbook).toContain("npm run deploy:preview:prod-env");
    expect(runbook).toContain("[SENSITIVE]");
  });
});

describe("a dynamic data path does not widen the trace to the whole project", () => {
  it("marks every process.cwd() the OSM index assembles a path from", () => {
    // Comment lines mention the call by name, so read the code alone.
    const source = read("lib/venueIndexOsm.ts")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const cwdReads = source.match(/process\.cwd\(\)/g) ?? [];
    const marked = source.match(/\/\* turbopackIgnore: true \*\/ process\.cwd\(\)/g) ?? [];
    expect(cwdReads.length).toBeGreaterThan(0);
    expect(marked.length).toBe(cwdReads.length);
  });
});
