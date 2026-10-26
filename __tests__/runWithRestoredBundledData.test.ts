import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMITTED_BUNDLED_DATA_PATHS } from "../scripts/lib/committedBundledDataPaths.mjs";

const bundledWrapper = resolve(process.cwd(), "scripts/run-with-restored-bundled-data.mjs");
const nextEnvWrapper = resolve(process.cwd(), "scripts/run-with-restored-next-env.mjs");

function initialiseGit(cwd: string): void {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "gate0@example.test"], { cwd });
  execFileSync("git", ["config", "user.name", "Gate Zero"], { cwd });
  mkdirSync(join(cwd, "public", "data"), { recursive: true });
  writeFileSync(join(cwd, "public/data/baseline.json"), "{}\n", "utf8");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd });
}

describe("committed bundled data restore", () => {
  it.each([".env", ".env.local", ".env.development", ".env.development.local",
    ".env.test", ".env.test.local", ".env.production", ".env.production.local"])(
    "refuses mapped verification before payload startup when %s can reload credentials", (name) => {
      const cwd = join(tmpdir(), `pubmax-mapped-envfile-${Date.now()}-${name}`);
      mkdirSync(join(cwd, "scripts"), { recursive: true });
      initialiseGit(cwd);
      const sentinel = "TYPESAFE_API_KEY=fake-env-file-sentinel\n";
      writeFileSync(join(cwd, name), sentinel);
      writeFileSync(join(cwd, "scripts/verify-changed.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("payload-ran", "unsafe");');
      const result = spawnSync(process.execPath, [bundledWrapper, process.execPath, "scripts/verify-changed.mjs"], {
        cwd, encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`Mapped verification refuses project environment file ${name}.`);
      expect(existsSync(join(cwd, "payload-ran"))).toBe(false);
      expect(readFileSync(join(cwd, name), "utf8")).toBe(sentinel);
    },
  );

  it.each([false, true])("starts the mapped verifier and its grandchild keyless before setup (explicit controls: %s)", (explicitControls) => {
    const cwd = join(tmpdir(), `pubmax-mapped-keyless-${Date.now()}-${explicitControls}`);
    mkdirSync(join(cwd, "scripts"), { recursive: true });
    initialiseGit(cwd);
    writeFileSync(join(cwd, ".env.example"), "TYPESAFE_API_KEY=example-only\n");
    const credentials = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
      "DATABASE_URL", "PGPASSWORD", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
      "ELEVENLABS_API_KEY", "TYPESAFE_API_KEY", "EXA_API_KEY", "ORS_API_KEY", "UNKNOWN_FUTURE_PROVIDER_KEY",
      "GITHUB_TOKEN", "CODEX_API_KEY"];
    const probe = `JSON.stringify({ clean: ${JSON.stringify(credentials)}.every(key => !process.env[key]),
      heap: process.env.NODE_OPTIONS, workers: process.env.VITEST_MAX_WORKERS,
      heapLimitMiB: Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024),
      full: process.env.PUBMAX_VERIFY_FULL, base: process.env.PUBMAX_VERIFY_BASE,
      committed: process.env.PUBMAX_VERIFY_COMMITTED_DATA, deployment: process.env.DEPLOYMENT_VERSION,
      pgSlots: process.env.PUBMAX_PG_MAX_CLUSTERS, knipBase: process.env.PUBMAX_KNIP_BASE_REF,
      pathPresent: Boolean(process.env.PATH), homePresent: Boolean(process.env.HOME) })`;
    writeFileSync(join(cwd, "scripts/verify-changed.mjs"), `
      import { spawnSync } from "node:child_process";
      import { getHeapStatistics } from "node:v8";
      const beforeSetup = ${probe};
      const grandchild = spawnSync(process.execPath, ["-e", ${JSON.stringify(`const { getHeapStatistics } = require("node:v8"); console.log(${probe})`)}], { encoding: "utf8" });
      if (grandchild.status !== 0) process.exit(9);
      console.log(JSON.stringify({ beforeSetup: JSON.parse(beforeSetup), grandchild: JSON.parse(grandchild.stdout) }));
    `);
    const env: NodeJS.ProcessEnv = { ...process.env, ...Object.fromEntries(credentials.map(key => [key, "fake-sentinel"])),
      PUBMAX_VERIFY_FULL: "1", PUBMAX_VERIFY_BASE: "HEAD~1", PUBMAX_VERIFY_COMMITTED_DATA: "1",
      DEPLOYMENT_VERSION: "local", PUBMAX_PG_MAX_CLUSTERS: "2", PUBMAX_KNIP_BASE_REF: "origin/main",
      NODE_OPTIONS: explicitControls ? "--max-old-space-size=1024" : "",
      VITEST_MAX_WORKERS: explicitControls ? "2" : "" };
    const result = spawnSync(process.execPath, [bundledWrapper, process.execPath, "scripts/verify-changed.mjs"], { cwd, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const expected = { clean: true, heap: explicitControls ? "--max-old-space-size=1024" : "--max-old-space-size=1536",
      heapLimitMiB: expect.any(Number),
      workers: explicitControls ? "2" : "1", full: "1", base: "HEAD~1", committed: "1", deployment: "local",
      pgSlots: "2", knipBase: "origin/main", pathPresent: true, homePresent: true };
    const observed = JSON.parse(result.stdout);
    expect(observed).toEqual({ beforeSetup: expected, grandchild: expected });
    for (const child of [observed.beforeSetup, observed.grandchild]) {
      const oldSpaceMiB = explicitControls ? 1024 : 1536;
      expect(child.heapLimitMiB).toBeGreaterThanOrEqual(oldSpaceMiB);
      expect(child.heapLimitMiB).toBeLessThan(oldSpaceMiB + 256);
    }
    for (const key of credentials) expect(env[key]).toBe("fake-sentinel");
  });

  it("names the trees the captain forbids in pipeline churn", () => {
    expect(COMMITTED_BUNDLED_DATA_PATHS).toEqual(["public/data"]);
  });

  it("restores public/data after the wrapped command succeeds", () => {
    const cwd = join(tmpdir(), `pubmax-bundled-restore-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    initialiseGit(cwd);
    execFileSync(process.execPath, [bundledWrapper, process.execPath, "-e", "require('fs').appendFileSync('public/data/baseline.json','dirty\\n')"], { cwd });
    expect(readFileSync(join(cwd, "public/data/baseline.json"), "utf8")).toBe("{}\n");
    expect(execFileSync("git", ["status", "--short", "public/data"], { cwd, encoding: "utf8" })).toBe("");
  });

  it("restores public/data after the wrapped command fails", () => {
    const cwd = join(tmpdir(), `pubmax-bundled-restore-fail-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    initialiseGit(cwd);
    const result = spawnSync(
      process.execPath,
      [bundledWrapper, process.execPath, "-e", "require('fs').appendFileSync('public/data/baseline.json','dirty\\n'); process.exit(9)"],
      { cwd },
    );
    expect(result.status).toBe(9);
    expect(readFileSync(join(cwd, "public/data/baseline.json"), "utf8")).toBe("{}\n");
  });

  it("clears the provider key only in the payload and forwards unrelated environment values", () => {
    const cwd = join(tmpdir(), `pubmax-bundled-keyless-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    initialiseGit(cwd);
    writeFileSync(join(cwd, ".env.local"), "TYPESAFE_API_KEY=fake-non-mapped-env-file\n");
    const env = {
      ...process.env,
      OPENROUTER_API_KEY: "fake-sentinel-not-a-provider-key",
      TYPESAFE_API_KEY: "fake-typesafe-sentinel",
      CODEX_API_KEY: "fake-coding-sentinel",
      PUBMAX_DISPOSABLE_FORWARDING: "disposable-forwarding-value",
    };
    const result = spawnSync(process.execPath, [bundledWrapper, process.execPath, "-e", `
      console.log(JSON.stringify({
        providerKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
        typesafePreserved: process.env.TYPESAFE_API_KEY === "fake-typesafe-sentinel",
        codingAuthPreserved: process.env.CODEX_API_KEY === "fake-coding-sentinel",
        unrelatedValueForwarded: process.env.PUBMAX_DISPOSABLE_FORWARDING === "disposable-forwarding-value",
      }));
      require("fs").appendFileSync("public/data/baseline.json", "dirty\\n");
      process.exit(process.env.OPENROUTER_API_KEY ? 8 : 0);
    `], { cwd, env, encoding: "utf8" });
    expect(JSON.parse(result.stdout)).toEqual({ providerKeyPresent: false, typesafePreserved: true, codingAuthPreserved: true, unrelatedValueForwarded: true });
    expect(result.status).toBe(0);
    expect(Boolean(env.OPENROUTER_API_KEY)).toBe(true);
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toBe("TYPESAFE_API_KEY=fake-non-mapped-env-file\n");
    expect(readFileSync(join(cwd, "public/data/baseline.json"), "utf8")).toBe("{}\n");
  });

  it("removes a shard file the wrapped command added and keeps one that was already there", () => {
    const cwd = join(tmpdir(), `pubmax-bundled-restore-untracked-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    initialiseGit(cwd);
    writeFileSync(join(cwd, "public/data/draft.json"), "{}\n", "utf8");
    execFileSync(
      process.execPath,
      [bundledWrapper, process.execPath, "-e", "const fs=require('fs'); fs.mkdirSync('public/data/cities/new',{recursive:true}); fs.writeFileSync('public/data/cities/new/venues_slim.core.json','{}')"],
      { cwd },
    );
    expect(existsSync(join(cwd, "public/data/cities/new/venues_slim.core.json"))).toBe(false);
    expect(existsSync(join(cwd, "public/data/draft.json"))).toBe(true);
  });

  it("restores public/data after a browser build wrapper when CI allowlists it", () => {
    const cwd = join(tmpdir(), `pubmax-next-env-restore-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "tsconfig.json"), "{}\n", "utf8");
    initialiseGit(cwd);
    execFileSync(
      process.execPath,
      [nextEnvWrapper, process.execPath, "-e", "require('fs').appendFileSync('public/data/baseline.json','dirty\\n')"],
      { cwd, env: { ...process.env, PUBMAX_TRACKED_OUTPUTS: "public/data" } },
    );
    expect(execFileSync("git", ["status", "--short", "public/data"], { cwd, encoding: "utf8" })).toBe("");
  });
});

describe("no-mistakes verify wrapper regression", () => {
  it("leaves committed bundled data clean after validate-data on this tree", () => {
    const manifest = join(process.cwd(), "public/data/cities/bath/venues_slim.manifest.json");
    if (!existsSync(manifest)) return;
    const before = readFileSync(manifest, "utf8");
    writeFileSync(manifest, `${before.trimEnd()}\n`, "utf8");
    try {
      execFileSync(
        process.execPath,
        [bundledWrapper, "npm", "run", "validate-data"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DEPLOYMENT_VERSION: "local",
            PUBMAX_VERIFY_COMMITTED_DATA: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      expect(execFileSync("git", ["status", "--short", "public/data"], { encoding: "utf8" })).toBe("");
    } finally {
      execFileSync("git", ["restore", "--worktree", "--source=HEAD", "--", "public/data"], {
        cwd: process.cwd(),
      });
    }
  });
});
