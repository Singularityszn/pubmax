import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ENTRYPOINTS = [
  "scripts/refresh_pint_price_observations.mjs",
  "scripts/spoonme/import-report.mjs",
  "scripts/whatson/quizRefresh.mjs",
  "scripts/whatson/scrape_greene_king_sport.mjs",
] as const;

const COMMAND_DOCS = [
  ...ENTRYPOINTS,
  "data/freshness_registry.json",
  "data/AGENTS.md",
  "data/README.md",
  "public/data/spoonme/SOURCE.md",
] as const;

describe("manual guarded-harvest entry points", () => {
  it("never documents a bare Node invocation for a TypeScript-importing caller", () => {
    const bareInvocation = /\bnode\s+scripts\/(?:refresh_pint_price_observations\.mjs|spoonme\/import-report\.mjs|whatson\/(?:quizRefresh|scrape_greene_king_sport)\.mjs)/u;
    for (const file of COMMAND_DOCS) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).not.toMatch(bareInvocation);
    }
    for (const file of ENTRYPOINTS) {
      expect(readFileSync(join(ROOT, file), "utf8").split("\n", 1)[0], file).toBe(
        "#!/usr/bin/env tsx",
      );
    }
  });

  it("loads every caller through the supported tsx loader without starting a harvest", () => {
    const imports = ENTRYPOINTS.map((file) => `import(${JSON.stringify(`./${file}`)})`).join(",");
    expect(
      String(
        execFileSync(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", `await Promise.all([${imports}]); process.stdout.write("loaded")`],
          { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
        ),
      ),
    ).toBe("loaded");
  });
});
