import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

const require = createRequire(import.meta.url);
const oidcRequire = createRequire(require.resolve("@vercel/oidc"));
const configPath = oidcRequire.resolve("@vercel/cli-config");
const configRequire = createRequire(configPath);
const z: typeof import("zod") = configRequire("zod");
const config: {
  parseGlobalConfig: (value: unknown) => unknown;
  parseAuthConfig: (value: unknown) => unknown;
  parseAuthFileConfig: (value: unknown) => Record<string, unknown>;
  globalConfigSchema: ZodType;
  authConfigSchema: ZodType;
} = require(configPath);

describe("Zod resolved for @vercel/cli-config (GHSA-mrhx-c7xc-m3w5)", () => {
  // The upstream fix rejects oversized collections before validating elements.
  // Three values exercise that contract without a resource-exhaustion payload.
  it.each(["array max", "array length", "set max", "set size"] as const)(
    "rejects an oversized %s before validating its elements",
    (bound) => {
      let parsed = 0;
      const element = z.string().refine(() => {
        parsed++;
        return true;
      });
      const values = ["a", "b", "c"];
      const schemas = {
        "array max": () => z.array(element).max(2).safeParse(values),
        "array length": () => z.array(element).length(2).safeParse(values),
        "set max": () => z.set(element).max(2).safeParse(new Set(values)),
        "set size": () => z.set(element).size(2).safeParse(new Set(values)),
      };
      const result = schemas[bound]();
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([expect.objectContaining({ code: "too_big", path: [] })]);
      expect(parsed).toBe(0);
    },
  );

  it("still validates permitted collections and rejects invalid elements", () => {
    const schemas = [
      [z.array(z.string()).max(2), ["a", "b"], [1]],
      [z.set(z.string()).max(2), new Set(["a", "b"]), new Set([1])],
    ] as const;
    for (const [schema, valid, invalid] of schemas) {
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("real Vercel config parser compatibility", () => {
  it("accepts synthetic global config and preserves unknown keys at each level", () => {
    const value = {
      credStorage: "file",
      currentTeam: "team_synthetic",
      api: "https://example.invalid",
      telemetry: { enabled: false, futureTelemetry: true },
      guidance: { enabled: true, futureGuidance: "retained" },
      updates: { auto: false, bypassMinReleaseAge: false, futureUpdates: 1 },
      useNativeBinary: false,
      nativeBinaryAutoOptIn: true,
      futureGlobal: { enabled: true },
    };
    expect(config.parseGlobalConfig(value)).toEqual(value);
    expect(config.globalConfigSchema.parse(value)).toEqual(value);
    expect(config.parseGlobalConfig({})).toEqual({});
  });

  it.each([
    { credStorage: "invalid" },
    { currentTeam: 1 },
    { telemetry: { enabled: "false" } },
    { guidance: { enabled: 1 } },
    { updates: { auto: "true" } },
    { useNativeBinary: "false" },
  ])("rejects invalid global config %j", (value) => {
    expect(() => config.parseGlobalConfig(value)).toThrow();
    expect(config.globalConfigSchema.safeParse(value).success).toBe(false);
  });

  it("accepts synthetic auth values and preserves unknown keys", () => {
    const value = {
      token: "synthetic-token",
      refreshToken: "synthetic-refresh-token",
      userId: "synthetic-user",
      expiresAt: 123456789,
      tokenSource: "env",
      skipWrite: true,
      futureAuth: { enabled: true },
    };
    expect(config.parseAuthConfig(value)).toEqual(value);
    expect(config.authConfigSchema.parse(value)).toEqual(value);
    const fileValue = config.parseAuthFileConfig(value);
    expect(fileValue).not.toHaveProperty("tokenSource");
    expect({ ...fileValue, tokenSource: value.tokenSource }).toEqual(value);
    expect(config.parseAuthConfig({})).toEqual({});
  });

  it.each([{ token: 1 }, { expiresAt: "123" }, { skipWrite: "true" }, { tokenSource: "invalid" }])(
    "rejects invalid auth config %j",
    (value) => {
      expect(() => config.parseAuthConfig(value)).toThrow();
      expect(config.authConfigSchema.safeParse(value).success).toBe(false);
    },
  );
});
