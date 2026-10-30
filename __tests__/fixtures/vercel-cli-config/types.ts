import type * as CliConfig from "../../../vendor/vercel-cli-config";
import type { z } from "zod";
import type * as InstalledCliConfig from "@vercel/cli-config";

// Compile-only public consumer contracts. No provider or credential file is read.
export function acceptsPublicTypes(api: typeof CliConfig, schema: z.ZodType<string>) {
  const auth: CliConfig.AuthConfig = { token: "fixture-only", tokenSource: "env" };
  const global: CliConfig.GlobalConfig = { credStorage: "auto", telemetry: { enabled: false } };
  api.writeAuthConfig("/synthetic-config", auth);
  api.writeGlobalConfigFile("/synthetic-config/config.json", global);
  const result: string = api.readConfigFile("/synthetic-config/value.json", schema);
  // @ts-expect-error The public token contract accepts strings, not numbers.
  const invalidAuth: CliConfig.AuthConfig = { token: 123 };
  // @ts-expect-error The public credential-storage vocabulary is closed.
  const invalidStorage: CliConfig.CredStorage = "database";
  return { result, invalidAuth, invalidStorage };
}

export function acceptsInstalledTypes(api: typeof InstalledCliConfig, schema: z.ZodType<string>) {
  return acceptsPublicTypes(api, schema);
}
