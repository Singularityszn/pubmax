// Hand-written types for the Vercel CLI resolver (allowJs is off). Keep in
// lockstep with scripts/lib/vercelCli.mjs.

export declare const VERCEL_CLI_VERSION: string;

export declare function vercelCommand(
  args: readonly string[],
  env?: Record<string, string | undefined>,
): { command: string; args: string[] };
