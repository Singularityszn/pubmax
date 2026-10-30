import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("Pristine Vercel CLI config lint policy", () => {
  it("excludes only the thirteen original compiled modules and declarations", async () => {
    const eslint = new ESLint({ cwd: root });
    const originalFiles = [
      "cli-config.js", "cli-config.d.ts", "cred-storage.js", "cred-storage.d.ts",
      "index.d.ts", "paths.js", "paths.d.ts", "schema.js", "schema.d.ts",
      "schema.zod.js", "schema.zod.d.ts", "types.js", "types.d.ts",
    ];
    for (const file of originalFiles) {
      expect(await eslint.isPathIgnored(`vendor/vercel-cli-config/dist/${file}`), file).toBe(true);
    }
  });

  it("keeps authored code and future vendor files under normal lint rules", async () => {
    const eslint = new ESLint({ cwd: root });
    for (const file of [
      "vendor/vercel-cli-config/index.cjs",
      "vendor/vercel-cli-config/dist/future-authored-module.js",
      "__tests__/vercelCliConfigPackaging.test.ts",
      "__tests__/fixtures/vercel-cli-config/types.ts",
      "__tests__/vercelCliConfigLintPolicy.test.ts",
    ]) {
      expect(await eslint.isPathIgnored(file), file).toBe(false);
      expect((await eslint.calculateConfigForFile(file))?.rules?.["no-empty"], file).toEqual([2, { allowEmptyCatch: true }]);
    }
  });

  it("permits only the four required CommonJS imports in the root entry", async () => {
    const eslint = new ESLint({ cwd: root });
    for (const specifier of [
      "./dist/types.js", "./dist/schema.js", "./dist/cli-config.js", "./dist/cred-storage.js",
    ]) {
      const results = await eslint.lintText(`require(${JSON.stringify(specifier)});\n`, {
        filePath: "vendor/vercel-cli-config/index.cjs",
      });
      const violations = results.flatMap((result) => result.messages)
        .filter((message) => message.ruleId === "@typescript-eslint/no-require-imports");
      expect(violations, specifier).toEqual([]);
    }
  });

  it("rejects unlisted imports and imports outside the exact CommonJS entry", async () => {
    const eslint = new ESLint({ cwd: root });
    for (const [filePath, specifier] of [
      ["vendor/vercel-cli-config/index.cjs", "node:fs"],
      ["vendor/vercel-cli-config/index.cjs", "./dist/other.js"],
      ["vendor/vercel-cli-config/index.cjs", "./dist/schema.js?extra"],
      ["vendor/vercel-cli-config/index.cjs", "../dist/types.js"],
      ["vendor/vercel-cli-config/future-entry.cjs", "./dist/types.js"],
    ] as const) {
      const results = await eslint.lintText(`require(${JSON.stringify(specifier)});\n`, { filePath });
      expect(results.flatMap((result) => result.messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleId: "@typescript-eslint/no-require-imports", severity: 2 }),
      ]));
    }
  });

  it("still rejects an empty block inside the CommonJS entry", async () => {
    const eslint = new ESLint({ cwd: root });
    const results = await eslint.lintText("if (true) {}\n", {
      filePath: "vendor/vercel-cli-config/index.cjs",
    });
    expect(results.flatMap((result) => result.messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "no-empty", severity: 2 }),
    ]));
  });
});
