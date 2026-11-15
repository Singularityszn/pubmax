import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SOCIAL_FRIENDS_LAUNCH_ENV } from "@/lib/socialLaunch";

const ROOT = process.cwd();

// P0-3: a rollout flag CI sets and no deployment ever sets is dark code. These
// three were exactly that, so each is deleted and its flag-on behaviour is the
// only behaviour. No source, config or workflow file may name one again.
const RETIRED_ENV_NAMES = [
  "PUBMAX_MAP_ROUTE_TRANSFER",
  "PUBMAX_TONIGHT_GROUPING",
  "PUBMAX_PAL_HANDOFF",
] as const;

// Where a flag can actually be read or set. Docs and proof keep the retired
// names as the record of why they went, which is evidence rather than a switch.
const RETIREMENT_SCAN_PATHS = [
  "app",
  "components",
  "lib",
  "scripts",
  ".github/workflows",
  ".env.example",
  "next.config.mjs",
  "playwright.config.ts",
  "proxy.ts",
  "vercel.json",
] as const;

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

function filesAt(relativePath: string): string[] {
  const absolutePath = join(ROOT, relativePath);
  if (statSync(absolutePath).isFile()) {
    const extension = relativePath.slice(relativePath.lastIndexOf("."));
    return TEXT_FILE_EXTENSIONS.has(extension) || !relativePath.includes(".")
      ? [relativePath]
      : [];
  }
  return readdirSync(absolutePath).flatMap((entry) =>
    entry === "node_modules" ? [] : filesAt(join(relativePath, entry)),
  );
}

const SCANNED_FILES = RETIREMENT_SCAN_PATHS.flatMap(filesAt);

describe("rollout flags", () => {
  // A rollout switch a deployment cannot see is how the retired ones stayed
  // dark. The one live switch must be a line a deployment can copy out of
  // .env.example.
  it("documents the Social launch switch in .env.example", () => {
    const envExample = readFileSync(join(ROOT, ".env.example"), "utf8");
    const declared = new Set(
      envExample
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.split("=")[0]),
    );

    expect(declared).toContain(SOCIAL_FRIENDS_LAUNCH_ENV);
  });

  it("names no retired flag anywhere a deployment could set or read one", () => {
    expect(SCANNED_FILES.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of SCANNED_FILES) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const env of RETIRED_ENV_NAMES) {
        if (source.includes(env)) offenders.push(`${file} names ${env}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
