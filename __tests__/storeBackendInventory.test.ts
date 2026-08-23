import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function repositoryStoreNames(): string[] {
  return readdirSync(join(ROOT, "lib"))
    .filter((file) => file.endsWith("Store.ts"))
    .map((file) => file.slice(0, -3))
    .sort();
}

function documentedStoreNames(): string[] {
  const markdown = readFileSync(join(ROOT, "docs/STORE_BACKEND_INVENTORY.md"), "utf8");
  return [...markdown.matchAll(/^\|\s*([A-Za-z][A-Za-z0-9]*Store)\s*\|/gm)]
    .map((match) => match[1])
    .sort();
}

function repositoryInlineBackendReferences(): string[] {
  return execFileSync(
      "rg",
      [
      "-a",
      "-l",
      "selectStore|isSupabaseConfigured",
      "app",
      "components",
      "lib",
      "scripts",
      "--glob",
      "*.ts",
      "--glob",
      "*.tsx",
      "--glob",
      "*.mjs",
      "--glob",
      "*.js",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

function documentedInlineBackendReferences(): string[] {
  const markdown = readFileSync(join(ROOT, "docs/STORE_BACKEND_INVENTORY.md"), "utf8");
  const block = markdown.match(
    /<!-- inline-backend-references:start -->\n```json\n([\s\S]*?)\n```\n<!-- inline-backend-references:end -->/,
  );
  if (!block) throw new Error("missing inline backend reference inventory");
  return JSON.parse(block[1]).inlineBackendReferences;
}

describe("store backend inventory", () => {
  it("documents every current lib/*Store.ts exactly once", () => {
    const actual = repositoryStoreNames();
    const documented = documentedStoreNames();

    expect(documented).toEqual(actual);
    expect(new Set(documented).size).toBe(documented.length);
  });

  it("names every non-factory store in the documented exception list", () => {
    const markdown = readFileSync(join(ROOT, "docs/STORE_BACKEND_INVENTORY.md"), "utf8");
    const exceptionSection = markdown.slice(markdown.indexOf("## Exception list"));
    const rows = [
      ...markdown.matchAll(
        /^\|\s*([A-Za-z][A-Za-z0-9]*Store)\s*\|\s*([^|]+)\s*\|/gm,
      ),
    ];

    for (const [, store, classification] of rows) {
      if (classification.trim() === "factory-ready") continue;
      expect(exceptionSection).toContain(`\`${store}\``);
    }
  });

  it("documents every production inline backend reference", () => {
    expect(documentedInlineBackendReferences()).toEqual(repositoryInlineBackendReferences());
    expect(documentedInlineBackendReferences()).toContain("lib/messageAuth.ts");
  });
});
