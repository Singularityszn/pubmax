import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  INSTALL_SCRIPT_REASONS,
  PACKAGE_DIRS,
  checkAllowlist,
  packagesWithInstallScripts,
} from "@/scripts/ci/install-script-allowlist.mjs";

const ROOT = process.cwd();

type Step = { name?: string; run?: string };
type Job = {
  "runs-on": string;
  env?: Record<string, string | number>;
  strategy?: { matrix?: { shard?: number[] } };
  steps: Step[];
};

const workflows = readdirSync(join(ROOT, ".github/workflows"))
  .filter((file) => file.endsWith(".yml"))
  .sort()
  .map((file) => ({
    file,
    parsed: parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as { jobs: Record<string, Job> },
  }));

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

  it("are checked by the pre-push gate", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts.verify).toContain("node scripts/ci/install-script-allowlist.mjs --check");
    expect(scripts["deps:install-scripts"]).toBe("node scripts/ci/install-script-allowlist.mjs");
  });
});

describe("Mac pool browser commands", () => {
  // Playwright starts half the machine's cores as workers when CI leaves the
  // count unset. A hosted macOS runner gave one; the Mac pool would give 9,
  // and four already killed the single production server on this rig.
  it("holds every Mac pool Playwright run to one worker", async () => {
    vi.stubEnv("SMOKE_BASE_URL", "https://pubmaxxing.com");
    vi.stubEnv("SMOKE_REQUIRE_SIGN_IN", "0");
    try {
      const { default: smokeConfig } = await import("@/playwright.prod-smoke.config");
      for (const { file, parsed } of workflows) {
        for (const [id, job] of Object.entries(parsed.jobs)) {
          if (job["runs-on"] !== "pubmax-mac") continue;
          const where = `${file} / ${id}`;
          for (const shard of job.strategy?.matrix?.shard ?? [1]) {
            const commands: string[][] = [];
            for (const step of job.steps) {
              if (!step.run || !/\bplaywright\s+test\b/.test(step.run)) continue;
              const run = step.run
                .replaceAll("${{ env.LAYOUT_SHARD }}", String(job.env?.LAYOUT_SHARD))
                .replaceAll("${{ matrix.shard }}", String(shard));
              const executed = spawnSync("bash", ["-e", "-c", `npx() { printf '%s\\0' "$@"; printf '\\0'; }\n${run}`], {
                cwd: ROOT, encoding: "utf8",
              });
              expect(executed.status, `${where} / ${step.name}: ${executed.stderr}`).toBe(0);
              commands.push(...executed.stdout.split("\0\0").filter(Boolean).map((call) => call.split("\0")));
            }
            const tests = commands.filter((args) => args[0] === "playwright" && args[1] === "test");
            expect(tests.length, where).toBeGreaterThan(0);
            for (const args of tests) {
              const { values } = parseArgs({
                args: args.slice(2),
                options: { workers: { type: "string", short: "j" }, config: { type: "string", short: "c" } },
                strict: false, allowPositionals: true,
              });
              if (values.config !== undefined) expect(values.config, where).toBe("playwright.prod-smoke.config.ts");
              if (values.workers !== undefined) {
                expect(typeof values.workers, where).toBe("string");
                expect(Number(values.workers), `${where} / shard ${shard}`).toBe(1);
              } else {
                expect(values.config, where).toBe("playwright.prod-smoke.config.ts");
                expect(smokeConfig.workers, where).toBe(1);
              }
            }
          }
        }
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
