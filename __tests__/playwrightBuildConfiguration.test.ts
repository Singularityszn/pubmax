import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadConfig(env: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({
    PW_PORT: "3100",
    PW_KEYLESS_PORT: "3101",
    PW_SCREENSHOTS: "",
    PW_SKIP_WEBSERVER: "",
    PW_SKIP_KEYLESS_WEBSERVER: "",
    PW_DISPOSABLE_PLAN_DB: "",
    PW_DISPOSABLE_PLAN_AUTH: "",
    PW_PREBUILT: "",
    PW_FIREFOX_DESKTOP_MAP_CHROME_FIT: "",
    PUBMAX_E2E_LOGIN: "",
    PUBMAX_PUBLIC_EVIDENCE_PHASE: "",
    NEXT_DIST_DIR: undefined,
    PW_NEXT_DIST_DIR: undefined,
    PW_KEYLESS_NEXT_DIST_DIR: undefined,
    ...env,
  })) vi.stubEnv(key, value);
  vi.resetModules();
  return (await import("../playwright.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const directoryCases: [string, Record<string, string>, string][] = [
  ["explicit screenshot override", {
    PW_NEXT_DIST_DIR: ".next-custom", PW_SCREENSHOTS: "1", NEXT_DIST_DIR: ".next-isolated",
  }, ".next-custom"],
  ["explicit normal E2E override", {
    PW_NEXT_DIST_DIR: ".next-custom", NEXT_DIST_DIR: ".next-prod",
  }, ".next-custom"],
  ["screenshot wrapper directory", {
    PW_SCREENSHOTS: "1", NEXT_DIST_DIR: ".next-isolated",
  }, ".next-isolated"],
  ["screenshot default", { PW_SCREENSHOTS: "1" }, ".next"],
  ["normal E2E default", { NEXT_DIST_DIR: ".next-prod" }, ".next-e2e"],
];

describe("Playwright isolated build configuration", () => {
  it.each(directoryCases)("passes %s to the server", async (_label, env, expected) => {
    const config = await loadConfig(env);
    const screenshotRun = env.PW_SCREENSHOTS === "1";
    const servers = [{
      command: screenshotRun
        ? "npm run start -- --port 3100"
        : "node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port 3100",
      url: "http://localhost:3100",
      env: expect.objectContaining({ NEXT_DIST_DIR: expected }),
    }];
    if (!screenshotRun) servers.push({
      command: "node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port 3101",
      url: "http://localhost:3101",
      env: expect.objectContaining({
        NEXT_DIST_DIR: `${expected}-keyless`,
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      }),
    });
    expect(config.webServer).toEqual(servers.map((server) => expect.objectContaining(server)));
    expect(config.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "chromium-keyless",
        use: expect.objectContaining({ baseURL: "http://localhost:3101" }),
      }),
    ]));
  });

  it("omits managed servers when the caller supplies them", async () => {
    const config = await loadConfig({ PW_SKIP_WEBSERVER: "1" });
    expect(config.webServer).toBeUndefined();
  });

  it("keeps test scratch copies outside the typecheck", () => {
    const tsconfig = JSON.parse(readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")) as { exclude?: string[] };
    expect(tsconfig.exclude).toContain("test-results");
  });

  it("keeps isolated builds outside lint and Git inputs while retaining source", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const builds = [".next-e2e/server/page.js", ".next-custom-keyless/server/page.js", ".next-isolated/server/page.js"];
    const source = "lib/playwrightDistDir.ts";
    for (const file of builds) {
      await expect(eslint.isPathIgnored(path.join(ROOT, file))).resolves.toBe(true);
    }
    await expect(eslint.isPathIgnored(path.join(ROOT, source))).resolves.toBe(false);
    if (existsSync(path.join(ROOT, ".gitignore"))) {
      const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
        cwd: ROOT,
        encoding: "utf8",
        input: [...builds, source].join("\n") + "\n",
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual(builds);
    } else {
      expect(existsSync(path.join(ROOT, ".git"))).toBe(false);
    }
  });
});
