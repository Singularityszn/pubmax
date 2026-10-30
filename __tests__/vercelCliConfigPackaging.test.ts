import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Oracles: the published 0.3.1 public API, its documented auth-file contract,
// and the required single external Zod 4.6.7 package. No real credentials are used.
const consumer = createRequire(import.meta.url);
const subject = process.env.PUBMAX_CLI_CONFIG_SUBJECT ?? "prototype";
if (subject !== "prototype" && subject !== "installed") {
  throw new Error("PUBMAX_CLI_CONFIG_SUBJECT must be prototype or installed");
}
const packageConsumer = subject === "installed"
  ? createRequire(consumer.resolve("@vercel/oidc"))
  : consumer;
const entry = packageConsumer.resolve(subject === "installed"
  ? "@vercel/cli-config"
  : "../vendor/vercel-cli-config");
const api = packageConsumer(entry) as typeof import("../vendor/vercel-cli-config");
const fixtures: string[] = [];

function fixtureDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "pubmax-cli-config-contract-"));
  fixtures.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Vercel CLI config replacement package", () => {
  it("exposes the original 34 public exports without adding the private path helper", () => {
    expect(Object.keys(api).sort()).toEqual([
      "CRED_STORAGE_CONFIG_VALUES", "CRED_STORAGE_VALUES", "DEFAULT_CRED_STORAGE",
      "authConfigHasUsableTokenData", "authConfigSchema", "credStorageSchema",
      "defaultAuthConfig", "defaultGlobalConfig", "deleteAuthConfig", "deleteAuthConfigFile",
      "getAuthConfigFilePath", "getCachePath", "getConfigFilePath", "getDataPath",
      "getDefaultAuthConfig", "getGlobalPathConfig", "getLikelyEffectiveCredStorage",
      "globalConfigSchema", "guidanceConfigSchema", "parseAuthConfig", "parseAuthFileConfig",
      "parseGlobalConfig", "readAuthConfig", "readAuthConfigFile", "readAuthFileConfig",
      "readConfigFile", "readGlobalConfigFile", "telemetryConfigSchema", "tryReadAuthConfig",
      "updatesConfigSchema", "writeAuthConfig", "writeAuthConfigFile", "writeConfigFile",
      "writeGlobalConfigFile",
    ].sort());
    expect(api.CRED_STORAGE_CONFIG_VALUES).toEqual(["auto", "file", "keyring"]);
    expect(api.CRED_STORAGE_VALUES).toEqual(["file", "keyring"]);
    expect(api.DEFAULT_CRED_STORAGE).toBe("file");
  });

  it("loads the application external Zod through the package module graph", () => {
    const visited = new Set<string>();
    const pending = [packageConsumer.cache[entry]];
    while (pending.length) {
      const module = pending.pop();
      if (!module || visited.has(module.filename)) continue;
      visited.add(module.filename);
      pending.push(...module.children);
    }
    const zodEntry = consumer.resolve("zod");
    expect([...visited].map((path) => realpathSync(path))).toContain(realpathSync(zodEntry));
    const packageZod = createRequire(entry).resolve("zod");
    expect(realpathSync(packageZod)).toBe(realpathSync(zodEntry));
    const metadata = consumer("zod/package.json") as { version: string };
    expect(metadata.version).toBe("4.6.7");
  });

  // Upstream a0ebf97 checks collection bounds before parsing any elements.
  // Start with the package's own public schema, so an unused Zod import cannot
  // make a still-bundled schema implementation pass this contract.
  it.each(["maximum", "exact length"] as const)(
    "rejects a collection beyond its %s before parsing config elements",
    (bound) => {
      let parsed = 0;
      const element = api.authConfigSchema.refine(() => {
        parsed++;
        return true;
      });
      const array = element.array();
      const schema = bound === "maximum" ? array.max(2) : array.length(2);
      const values = [{ token: "fixture-one" }, { token: "fixture-two" }, { token: "fixture-three" }];
      const oversized = schema.safeParse(values);
      expect(oversized.success).toBe(false);
      expect(oversized.error?.issues).toEqual([expect.objectContaining({ code: "too_big", path: [] })]);
      expect(parsed).toBe(0);
      expect(schema.safeParse(values.slice(0, 2)).success).toBe(true);
      expect(parsed).toBe(2);
      expect(schema.safeParse([{ token: 123 }, { token: "fixture-two" }]).success).toBe(false);
    },
  );

  it("supports native Node ESM consumers and the dedicated paths export", () => {
    const childEnv: NodeJS.ProcessEnv = { HOME: fixtureDirectory() };
    for (const name of ["NODE_OPTIONS", "SPOONS_PROOF_LOG", "SPOONS_PROOF_PHASE"] as const) {
      const value = process.env[name];
      if (value !== undefined) childEnv[name] = value;
    }
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      const api = await import(${JSON.stringify(pathToFileURL(entry).href)});
      if (typeof api.parseAuthConfig !== "function") throw new Error("Missing named export");
      process.stdout.write(JSON.stringify(api.parseAuthConfig({ token: "fixture-only-token" })));
    `], { encoding: "utf8", env: childEnv, timeout: 10000 });
    expect(JSON.parse(output)).toEqual({ token: "fixture-only-token" });
    const pathsConsumer = createRequire(entry);
    const paths = pathsConsumer("@vercel/cli-config/paths") as { getAuthConfigFilePath: (directory: string) => string };
    const directory = fixtureDirectory();
    expect(paths.getAuthConfigFilePath(directory)).toBe(api.getAuthConfigFilePath(directory));
  });

  it("keeps public schemas, passthrough fields and auth-file tokenSource removal", () => {
    const auth = { token: "fixture-only-token", tokenSource: "env", extra: { enabled: true } };
    expect(api.parseAuthConfig(auth)).toEqual(auth);
    expect(api.parseAuthFileConfig(auth)).toEqual({ token: "fixture-only-token", extra: { enabled: true } });
    expect(() => api.parseAuthConfig({ token: 123 })).toThrow();
    expect(api.parseGlobalConfig({ credStorage: "auto", telemetry: { enabled: false, future: true }, extra: 7 }))
      .toEqual({ credStorage: "auto", telemetry: { enabled: false, future: true }, extra: 7 });
    expect(() => api.parseGlobalConfig({ credStorage: "invalid" })).toThrow("Invalid value for `credStorage`");
  });

  it("writes only a synthetic private auth file, honours skipWrite and deletes it", () => {
    const directory = fixtureDirectory();
    const path = api.getAuthConfigFilePath(directory);
    expect(dirname(path)).toBe(directory);
    expect(api.tryReadAuthConfig(directory)).toBeNull();
    api.writeAuthConfig(directory, { token: "fixture-only-token", userId: "fixture-user" });
    expect(api.readAuthConfig(directory)).toEqual({ token: "fixture-only-token", userId: "fixture-user" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const before = readFileSync(path, "utf8");
    api.writeAuthConfig(directory, { token: "must-not-replace", skipWrite: true });
    expect(readFileSync(path, "utf8")).toBe(before);
    writeFileSync(path, "{invalid-json");
    expect(api.tryReadAuthConfig(directory)).toBeNull();
    api.deleteAuthConfig(directory);
    expect(api.tryReadAuthConfig(directory)).toBeNull();
  });

  it("keeps token-storage decisions within the supplied synthetic directory", () => {
    const directory = fixtureDirectory();
    const original = process.env.VERCEL_TOKEN_STORAGE;
    try {
      process.env.VERCEL_TOKEN_STORAGE = "auto";
      expect(api.getLikelyEffectiveCredStorage(directory)).toBe("keyring");
      api.writeAuthConfig(directory, { refreshToken: "fixture-only-refresh" });
      expect(api.getLikelyEffectiveCredStorage(directory)).toBe("file");
      process.env.VERCEL_TOKEN_STORAGE = "keyring";
      expect(api.getLikelyEffectiveCredStorage(directory)).toBe("keyring");
      process.env.VERCEL_TOKEN_STORAGE = "invalid";
      expect(() => api.getLikelyEffectiveCredStorage(directory)).toThrow("VERCEL_TOKEN_STORAGE");
    } finally {
      if (original === undefined) delete process.env.VERCEL_TOKEN_STORAGE;
      else process.env.VERCEL_TOKEN_STORAGE = original;
    }
  });
});
