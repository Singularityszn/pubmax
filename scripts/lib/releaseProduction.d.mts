export const PRODUCTION_ORIGIN: string;
export const SMOKE_WORKFLOW: string;
export const RELEASE_BRANCH: string;
export const DEFAULT_REPOSITORY: string;

export function parseDeploymentUrl(output: string | null | undefined): string | null;

export type SmokeRunRow = { databaseId: number; headSha: string; createdAt: string };

export function pickDispatchedRun(
  runs: readonly SmokeRunRow[] | null | undefined,
  input: { sha: string; dispatchedAtMs: number },
): SmokeRunRow | null;

export class ReleaseRefusal extends Error {}

export type ReleaseDeps = {
  run: (
    command: string,
    args: string[],
    options?: { capture?: boolean },
  ) => Promise<{ status: number; stdout: string }>;
  deploymentIdAt: (origin: string) => Promise<string | null>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  say: (line: string) => void;
  preflight?: Array<{ name: string; run: () => Promise<void> }>;
};

export type ReleaseOptions = {
  repository?: string;
  liveTimeoutMs?: number;
  runLookupTimeoutMs?: number;
  pollMs?: number;
};

export function releaseProduction(
  deps: ReleaseDeps,
  options?: ReleaseOptions,
): Promise<{ sha: string; deploymentId: string; deploymentUrl: string; smokeRunId: number }>;
