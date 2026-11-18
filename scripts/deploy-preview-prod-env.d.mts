// Hand-written types for the preview production-environment deploy command
// (allowJs is off). Keep in lockstep with scripts/deploy-preview-prod-env.mjs.

export type DeployPreviewProdEnvDeps = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  spawn?: (
    command: string,
    args: readonly string[],
    options: { cwd?: string; stdio?: unknown; env?: NodeJS.ProcessEnv },
  ) => { status: number | null; error?: Error | undefined };
  readFile?: (path: string, encoding: "utf8") => string;
  execFile?: (
    file: string,
    args: readonly string[],
    options: { cwd?: string; encoding: "utf8"; stdio?: unknown },
  ) => string;
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  pulledEnvPath?: string;
  root?: string;
};

export declare function runDeployPreviewProdEnv(
  deps?: DeployPreviewProdEnvDeps,
): number;
