import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createTrustedHandoffFlagsDTO,
  TRUSTED_HANDOFF_FLAG_KEYS,
  trustedHandoffFlagEnabled,
} from "@/lib/trustedHandoffFlags";
import {
  readTrustedHandoffFlag,
  readTrustedHandoffFlags,
  TRUSTED_HANDOFF_FLAG_DEFINITIONS,
} from "@/lib/trustedHandoffFlags.server";

const ROOT = process.cwd();

const ALL_ON_ENV = Object.fromEntries(
  Object.values(TRUSTED_HANDOFF_FLAG_DEFINITIONS).map(({ env }) => [env, "1"]),
);

// P0-3: a rollout flag CI sets and no deployment ever sets is dark code. These
// three were exactly that, so each is deleted and its flag-on behaviour is the
// only behaviour. No source, config or workflow file may name one again.
const RETIRED_ENV_NAMES = [
  "PUBMAX_MAP_ROUTE_TRANSFER",
  "PUBMAX_TONIGHT_GROUPING",
  "PUBMAX_PAL_HANDOFF",
] as const;

const RETIRED_FLAG_KEYS = ["mapRouteTransfer", "tonightGrouping", "palHandoff"] as const;

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

describe("trusted handoff flag registry", () => {
  it("registers one live rollout flag with ownership and removal metadata", () => {
    expect(TRUSTED_HANDOFF_FLAG_KEYS).toEqual(["socialFriendsLaunch"]);
    expect(Object.keys(TRUSTED_HANDOFF_FLAG_DEFINITIONS)).toEqual(TRUSTED_HANDOFF_FLAG_KEYS);

    for (const definition of Object.values(TRUSTED_HANDOFF_FLAG_DEFINITIONS)) {
      expect(definition.env).toMatch(/^PUBMAX_/);
      expect(definition.ownerLane).toMatch(/^L\d{2}$/);
      expect(definition.removalCondition.length).toBeGreaterThan(20);
      expect(definition.offBehavior.length).toBeGreaterThan(20);
    }
  });

  // The acceptance test for P0-3: a registered flag a deployment cannot see is
  // how the three retired ones stayed dark. Every remaining key must be a line
  // a deployment can copy out of .env.example.
  it("documents every registered flag in .env.example", () => {
    const envExample = readFileSync(join(ROOT, ".env.example"), "utf8");
    const declared = new Set(
      envExample
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.split("=")[0]),
    );

    for (const key of TRUSTED_HANDOFF_FLAG_KEYS) {
      const { env } = TRUSTED_HANDOFF_FLAG_DEFINITIONS[key];
      expect(declared, `${key} (${env}) is missing from .env.example`).toContain(env);
    }
  });

  it("keeps every retired flag key and environment name out of the registry", () => {
    const registeredEnvNames = Object.values(TRUSTED_HANDOFF_FLAG_DEFINITIONS).map(({ env }) => env);

    for (const key of RETIRED_FLAG_KEYS) {
      expect(TRUSTED_HANDOFF_FLAG_KEYS as readonly string[]).not.toContain(key);
    }
    for (const env of RETIRED_ENV_NAMES) {
      expect(registeredEnvNames).not.toContain(env);
    }

    // Earlier retirements, kept so a revived key cannot slip back in beside them.
    for (const key of [
      "landingFindMyPint",
      "intentWrite",
      "intentRead",
      "anchoredGeneration",
      "friendMemberRehydrationV2",
    ]) {
      expect(TRUSTED_HANDOFF_FLAG_KEYS as readonly string[]).not.toContain(key);
    }
    expect(registeredEnvNames).not.toContain("PUBMAX_FRIEND_MEMBER_REHYDRATION_V2");
  });

  it("names no retired flag anywhere a deployment could set or read one", () => {
    expect(SCANNED_FILES.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of SCANNED_FILES) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const env of RETIRED_ENV_NAMES) {
        if (source.includes(env) && file !== "__tests__/trustedHandoffFlags.test.ts") {
          offenders.push(`${file} names ${env}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("treats unknown flag names as off", () => {
    expect(readTrustedHandoffFlag("unknown", ALL_ON_ENV)).toBe(false);
    expect(trustedHandoffFlagEnabled(readTrustedHandoffFlags(ALL_ON_ENV), "unknown")).toBe(false);
  });

  it("keeps Social live by default and rolls back only on an explicit 0", () => {
    expect(readTrustedHandoffFlags({})).toEqual({ socialFriendsLaunch: true });
    expect(readTrustedHandoffFlags(ALL_ON_ENV)).toEqual({ socialFriendsLaunch: true });
    expect(readTrustedHandoffFlags({ PUBMAX_SOCIAL_FRIENDS_LAUNCH: "true" })).toEqual({
      socialFriendsLaunch: true,
    });
    expect(readTrustedHandoffFlags({ PUBMAX_SOCIAL_FRIENDS_LAUNCH: "0" })).toEqual({
      socialFriendsLaunch: false,
    });
  });

  it("returns the same immutable client DTO shape as the client constructor", () => {
    const serverFlags = readTrustedHandoffFlags(ALL_ON_ENV);
    const clientFlags = createTrustedHandoffFlagsDTO({ ...serverFlags });

    expect(serverFlags).toEqual(clientFlags);
    expect(Object.isFrozen(serverFlags)).toBe(true);
    expect(Object.isFrozen(clientFlags)).toBe(true);
  });

  it("never carries environment names or raw values into the client DTO", () => {
    const serialized = JSON.stringify(readTrustedHandoffFlags({
      ...ALL_ON_ENV,
      PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE: "secret-looking-raw-value",
    }));

    expect(serialized).not.toContain("PUBMAX_");
    expect(serialized).not.toContain("secret-looking-raw-value");
  });
});
