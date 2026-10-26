// THE LOCAL NO-MISTAKES GATE IS CHANGE-SCOPED; THE FULL SUITE RUNS ONCE, IN CI.
//
// Owner decision, 16 October 2026: the local pipeline ran the whole unit suite
// through `npm run coverage` (about 40 minutes on an 8 GB MacBook Air) and
// GitHub CI then ran it again. `scripts/verify-changed.mjs` now plans the local
// run from the diff against the merge-base with origin/main, and falls back to
// the full `npm run verify` when the change touches a shared foundation.
// These cases pin that plan: what escalates to the full suite, what is linted,
// typechecked and tested, and that CI still runs every unit test on every PR.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { POSTGRES_BACKED_SUITES } from "../scripts/rls/postgresSuites.mjs";
import {
  FULL_SUITE_FAN_IN,
  checkSteps,
  runCheckStep,
  fullSuiteReason,
  importGraph,
  planChecks,
  type ChangedFile,
} from "../scripts/verify-changed.mjs";
import { unitShards } from "@/__tests__/helpers/ciWorkflow";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  spawnSync: vi.fn(),
}));

afterEach(() => vi.unstubAllEnvs());

const ROOT = process.cwd();

/**
 * The explicitly listed provider credentials and configuration the full merge bar's
 * child must see empty. A bounded list, not every app secret and not a no-network
 * guarantee. Each push provider's names are listed together, so none is half-configured.
 */
const CREDENTIALS = [
  "AI_GATEWAY_API_KEY",
  "ARIZE_API_KEY",
  "BROWSERBASE_API_KEY",
  "CLERK_SECRET_KEY",
  "CONTEXT_DEV_API_KEY",
  "ELEVENLABS_API_KEY",
  "EVENTBRITE_API_TOKEN",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "FOOTBALL_DATA_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "KEENABLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "ORS_API_KEY",
  "PARALLEL_API_KEY",
  "POSTHOG_PROJECT_API_KEY",
  "PW_DISPOSABLE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "SKIDDLE_API_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TAVILY_API_KEY",
  "THESPORTSDB_API_KEY",
  "TICKETMASTER_API_KEY",
  "TYPESAFE_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
  "ARIZE_SPACE_KEY",
  "TFL_APP_KEY",
  "ELEVENLABS_LLM_SHARED_SECRET",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_PRIVATE_KEY",
  "APNS_ENV",
  "FCM_PROJECT_ID",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY_ID",
  "FCM_PRIVATE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "SOCIAL_CONNECTION_ENCRYPTION_KEY",
  "PUBMAX_ALERT_WEBHOOK_URL",
];

const modified = (...paths: string[]): ChangedFile[] => paths.map((path) => ({ path, status: "M" }));

/** A graph in which `target` is imported directly by `count` distinct modules. */
function fanIn(target: string, count: number): Map<string, Set<string>> {
  return new Map([[target, new Set(Array.from({ length: count }, (_, i) => `app/r${i}/page.tsx`))]]);
}

function plan(changed: ChangedFile[], options: Partial<Parameters<typeof planChecks>[0]> = {}) {
  return planChecks({
    changed,
    importers: new Map(),
    testFiles: [],
    readText: () => "",
    ...options,
  });
}

describe("the full-suite escalation", () => {
  it.each([
    "package.json",
    "package-lock.json",
    "vitest.config.mts",
    "vitest.setup.ts",
    "tsconfig.json",
    "tsconfig.build.json",
    "eslint.config.mjs",
    "next.config.mjs",
    "__tests__/helpers/defined.ts",
    "scripts/verify-changed.mjs",
  ])("runs the whole merge bar when %s changes", (path) => {
    expect(fullSuiteReason(modified(path), new Map())).toContain(path);
  });

  it(`runs the whole merge bar for a module more than ${FULL_SUITE_FAN_IN} modules import`, () => {
    const hub = "lib/supabase.ts";
    expect(fullSuiteReason(modified(hub), fanIn(hub, FULL_SUITE_FAN_IN + 1))).toContain(hub);
    expect(fullSuiteReason(modified(hub), fanIn(hub, FULL_SUITE_FAN_IN))).toBeNull();
  });

  it("runs the whole merge bar when a source module is deleted, because nothing resolves to it", () => {
    expect(fullSuiteReason([{ path: "lib/oldThing.ts", status: "D" }], new Map())).toContain(
      "lib/oldThing.ts",
    );
    // A deleted doc or test file is imported by nothing.
    expect(fullSuiteReason([{ path: "docs/old.md", status: "D" }], new Map())).toBeNull();
    expect(fullSuiteReason([{ path: "__tests__/old.test.ts", status: "D" }], new Map())).toBeNull();
  });

  it("can be forced with PUBMAX_VERIFY_FULL=1", () => {
    expect(fullSuiteReason(modified("lib/x.ts"), new Map(), { PUBMAX_VERIFY_FULL: "1" })).toContain(
      "PUBMAX_VERIFY_FULL",
    );
  });

  it("plans npm run verify and nothing else on escalation", () => {
    const full = plan(modified("package.json"));
    expect(full.full).not.toBeNull();
    expect(checkSteps(full).map((step) => [step.command, ...step.args].join(" "))).toEqual([
      "npm run verify",
    ]);
  });

  it("caps the full merge bar at a 2 GB Node heap and one Vitest worker, and applies scoped limits at the subprocess boundary", () => {
    expect(defined(checkSteps(plan(modified("package.json")))[0]).env).toEqual({
      NODE_OPTIONS: "--max-old-space-size=2048",
      VITEST_MAX_WORKERS: "1",
      ...Object.fromEntries(CREDENTIALS.map((name) => [name, ""])),
    });
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=4096");
    vi.stubEnv("VITEST_MAX_WORKERS", "8");
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    const scoped = checkSteps(plan(modified("lib/priceLabel.ts")));
    for (const step of scoped) {
      expect(runCheckStep(step)).toBe(true);
      expect(spawnSync).toHaveBeenLastCalledWith(step.command, step.args, expect.objectContaining({
        env: expect.objectContaining({
          NODE_OPTIONS: "--max-old-space-size=256", VITEST_MAX_WORKERS: "1",
          GOMEMLIMIT: "256MiB", GOMAXPROCS: "1",
        }),
      }));
    }
    const full = defined(checkSteps(plan(modified("package.json")))[0]);
    expect(runCheckStep(full)).toBe(true);
    expect(spawnSync).toHaveBeenLastCalledWith("npm", ["run", "verify"], expect.objectContaining({
      env: expect.objectContaining({ NODE_OPTIONS: "--max-old-space-size=2048", VITEST_MAX_WORKERS: "1" }),
    }));
  });

  it("runs the full merge bar with an empty TYPESAFE_API_KEY and leaves the parent's key in place", () => {
    const sentinel = "synthetic-typesafe-sentinel-not-a-real-key";
    vi.stubEnv("TYPESAFE_API_KEY", sentinel);
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    const full = defined(checkSteps(plan(modified("scripts/verify-changed.mjs")))[0]);
    expect(runCheckStep(full)).toBe(true);
    expect(spawnSync).toHaveBeenLastCalledWith("npm", ["run", "verify"], expect.objectContaining({
      env: expect.objectContaining({
        TYPESAFE_API_KEY: "", NODE_OPTIONS: "--max-old-space-size=2048", VITEST_MAX_WORKERS: "1",
      }),
    }));
    expect(process.env.TYPESAFE_API_KEY).toBe(sentinel);
  });

  it("runs the full merge bar in a child that sees every explicitly listed provider credential and configuration value empty, and leaves the parent's values in place", async () => {
    const { spawnSync: realSpawnSync } =
      await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const sentinels = Object.fromEntries(CREDENTIALS.map((name) => [name, `SYNTHETIC-${name}-sentinel`]));
    for (const name of CREDENTIALS) vi.stubEnv(name, defined(sentinels[name]));
    const oauth = "SYNTHETIC-claude-code-oauth-sentinel";
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", oauth);
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=4096");
    vi.stubEnv("VITEST_MAX_WORKERS", "8");

    // Stands in for npm run verify. It prints variable names only, never values.
    const check = [
      `const leaked = ${JSON.stringify(CREDENTIALS)}.filter((name) => process.env[name] !== "");`,
      `if (leaked.length > 0) console.error("credentials not empty: " + leaked.join(", "));`,
      `const limited = process.env.NODE_OPTIONS === "--max-old-space-size=2048" && process.env.VITEST_MAX_WORKERS === "1";`,
      `if (!limited) console.error("NODE_OPTIONS or VITEST_MAX_WORKERS is not the full merge bar limit");`,
      `process.exit(leaked.length === 0 && limited ? 0 : 1);`,
    ].join("\n");
    let childStatus: number | null | undefined;
    vi.mocked(spawnSync).mockClear();
    vi.mocked(spawnSync).mockImplementationOnce(((command: string, args: readonly string[], options: SpawnSyncOptions) => {
      expect([command, ...args]).toEqual(["npm", "run", "verify"]);
      const child = realSpawnSync(process.execPath, ["-e", check], options);
      childStatus = child.status;
      return child;
    }) as unknown as typeof spawnSync);

    const full = defined(checkSteps(plan(modified("package.json")))[0]);
    const ok = runCheckStep(full);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(childStatus).toBe(0);
    expect(ok).toBe(true);
    expect(CREDENTIALS.filter((name) => process.env[name] !== sentinels[name])).toEqual([]);
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN === oauth, "CLAUDE_CODE_OAUTH_TOKEN").toBe(true);
    expect(process.env.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    expect(process.env.VITEST_MAX_WORKERS).toBe("8");
  });

  it("builds with one Next worker and keeps the build typecheck on", async () => {
    const { default: config } = (await import(pathToFileURL(join(ROOT, "next.config.mjs")).href)) as {
      default: { experimental?: { cpus?: number }; typescript?: { ignoreBuildErrors?: boolean } };
    };
    expect(config.experimental?.cpus).toBe(1);
    expect(config.typescript?.ignoreBuildErrors).toBeUndefined();
  });
});

describe("a change-scoped plan", () => {
  it("lints the changed scripts, typechecks them with their direct importers and tests what relates to them", () => {
    const importers = new Map([
      ["lib/priceLabel.ts", new Set(["components/PriceBadge.tsx", "scripts/report.mjs"])],
    ]);
    const scoped = plan(modified("lib/priceLabel.ts", "docs/VOICE.md"), { importers });

    expect(scoped.full).toBeNull();
    expect(scoped.lint).toEqual(["lib/priceLabel.ts"]);
    // allowJs is off, so only TypeScript files go to the compiler.
    expect(scoped.typecheck).toEqual(["components/PriceBadge.tsx", "lib/priceLabel.ts"]);
    expect(scoped.tests).toEqual(["docs/VOICE.md", "lib/priceLabel.ts"]);
  });

  it("typechecks only what the root tsconfig compiles", () => {
    const outside = ["e2e/map.spec.ts", ".agents/skills/x/vite.config.ts", ".next-prod/types/a.ts"];
    expect(plan(modified(...outside)).typecheck).toEqual([]);
  });

  it("adds the tests that name a changed file by its path, which no import graph can see", () => {
    const texts: Record<string, string> = {
      "__tests__/voiceFence.test.ts": 'readFileSync(join(ROOT, "docs/VOICE.md"))',
      "__tests__/other.test.ts": "nothing to see",
    };
    const scoped = plan(modified("docs/VOICE.md"), {
      testFiles: Object.keys(texts),
      readText: (path) => defined(texts[path]),
    });
    expect(scoped.tests).toEqual(["__tests__/voiceFence.test.ts", "docs/VOICE.md"]);
  });

  it("searches deleted paths for the tests that name them, but never hands vitest a deleted file", () => {
    const texts: Record<string, string> = {
      "__tests__/designTokens.test.ts": 'readFileSync("docs/DESIGN_SYSTEM.md")',
    };
    const scoped = plan([{ path: "docs/DESIGN_SYSTEM.md", status: "D" }], {
      testFiles: Object.keys(texts),
      readText: (path) => defined(texts[path]),
    });
    expect(scoped.tests).toEqual(["__tests__/designTokens.test.ts"]);
  });

  it("typechecks the importers of the .mjs module a changed .d.mts sidecar declares", () => {
    const importers = new Map([["scripts/lib/geo.mjs", new Set(["lib/venues.ts"])]]);
    const scoped = plan(modified("scripts/lib/geo.d.mts"), { importers });
    expect(scoped.typecheck).toEqual(["lib/venues.ts", "scripts/lib/geo.d.mts"]);
  });

  it("runs test:rls when a PostgreSQL suite depends on the change, directly or through other modules", () => {
    const suite = defined(POSTGRES_BACKED_SUITES[0]);
    const importers = new Map([
      ["lib/accountGate.ts", new Set(["app/api/account/route.ts"])],
      ["app/api/account/route.ts", new Set([suite])],
    ]);
    expect(plan(modified("app/api/account/route.ts"), { importers }).rls).toBe(true);
    expect(plan(modified("lib/accountGate.ts"), { importers }).rls).toBe(true);
    expect(plan(modified("lib/unrelated.ts"), { importers }).rls).toBe(false);
  });

  it("leaves the PostgreSQL suites to npm run test:rls, and runs it when the database layer changes", () => {
    const suite = defined(POSTGRES_BACKED_SUITES[0]);
    expect(plan(modified("lib/x.ts")).rls).toBe(false);
    for (const path of ["supabase/migrations/0200_x.sql", "scripts/rls/postgresHost.mjs", suite]) {
      expect(plan(modified(path)).rls, path).toBe(true);
    }
    expect(plan(modified(suite)).tests).not.toContain(suite);
  });

  it("validates data, database types, e2e skips and the ChatGPT map only when their inputs change", () => {
    const quiet = plan(modified("lib/x.ts"));
    expect([quiet.validateData, quiet.dbTypes, quiet.e2eSkips, quiet.chatgptMap]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(plan(modified("data/price_sources.json")).validateData).toBe(true);
    expect(plan(modified("public/data/cities/bath/venues_slim.manifest.json")).validateData).toBe(true);
    expect(plan(modified("supabase/migrations/0200_x.sql")).dbTypes).toBe(true);
    expect(plan(modified("types/database.ts")).dbTypes).toBe(true);
    // Every input scripts/db/generate-database-types.mjs reads.
    expect(plan(modified("scripts/rls/session-fixture.sql")).dbTypes).toBe(true);
    expect(plan(modified("scripts/qa/migration-apply-list.mjs")).dbTypes).toBe(true);
    expect(plan(modified("e2e/map.spec.ts")).e2eSkips).toBe(true);
    expect(plan(modified("scripts/chatgpt-map/src/server.ts")).chatgptMap).toBe(true);
  });

  it("runs vitest related on two workers, without the cluster suites, and fails on any failing test", () => {
    const steps = checkSteps(plan(modified("lib/priceLabel.ts")));
    const vitest = defined(steps.find((step) => step.label === "unit tests (related)"));

    expect(vitest.args.slice(0, 4)).toEqual(["related", "--run", "--maxWorkers=1", "--passWithNoTests"]);
    for (const suite of POSTGRES_BACKED_SUITES) {
      expect(vitest.args.join(" ")).toContain(`--exclude ${suite}`);
    }
    expect(vitest.args.at(-1)).toBe("lib/priceLabel.ts");
    // --passWithNoTests only forgives an empty selection, never a failure.
    expect(vitest.args).not.toContain("--allowOnly");
    expect(vitest.args.some((arg) => arg.startsWith("--bail") || arg === "--silent")).toBe(false);
  });

  it("always runs the whole-tree gates that only npm run verify runs", () => {
    const labels = checkSteps(plan(modified("lib/x.ts"))).map((step) => step.label);
    expect(labels).toContain("deadcode");
    expect(labels).toContain("install-script allowlist");
    // No workflow runs the advisory audit, so the scoped gate keeps it.
    expect(labels).toContain("dependency audit");
  });

  it("plans nothing to lint, typecheck or test for a docs-only change no test names", () => {
    const labels = checkSteps(plan(modified("docs/plans/x.md"))).map((step) => step.label);
    expect(labels).not.toContain("eslint (changed files)");
    expect(labels).not.toContain("typecheck (changed files and direct importers)");
  });
});

describe("the import graph", () => {
  it("resolves @/ aliases, relative specifiers and .mjs siblings to tracked files", () => {
    const sources: Record<string, string> = {
      "lib/a.ts": 'import { b } from "./b";\nexport const a = b;',
      "lib/b.ts": "export const b = 1;",
      "app/page.tsx": 'import { a } from "@/lib/a";\nconst lazy = () => import("../scripts/c.mjs");',
      "scripts/c.mjs": "export const c = 1;",
      "__tests__/a.test.ts": 'vi.mock("@/lib/b");\nimport "node:fs";',
    };
    const graph = importGraph(Object.keys(sources), (path) => defined(sources[path]));

    expect([...defined(graph.get("lib/b.ts"))].sort()).toEqual(["__tests__/a.test.ts", "lib/a.ts"]);
    expect([...defined(graph.get("lib/a.ts"))]).toEqual(["app/page.tsx"]);
    expect([...defined(graph.get("scripts/c.mjs"))]).toEqual(["app/page.tsx"]);
    expect(graph.has("node:fs")).toBe(false);
  });
});

describe("the full suite still runs once, in GitHub CI, on every code pull request", () => {
  it("keeps the CI unit shards on the whole suite through npm run coverage", () => {
    const workflow = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8"));
    expect(Object.keys(workflow.on)).toContain("pull_request");
    expect(workflow.on.pull_request).toBeNull();

    const shards = unitShards();
    expect(shards.length).toBeGreaterThanOrEqual(2);
    for (const { words } of shards) {
      expect(words.slice(0, 4)).toEqual(["npm", "run", "coverage", "--"]);
      expect(words).not.toContain("related");
      expect(words.some((word) => word.startsWith("--changed"))).toBe(false);
    }
  });
});
