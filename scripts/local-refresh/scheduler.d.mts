export interface RefreshSummary {
  newPubs: number;
  newPriceRows: number;
  priceChanges: number;
  refreshedPriceRows: number;
  newDeals: number;
  newEvents: number;
  locationFixes: number;
  enrichmentChanges: number;
}

export interface RefreshSnapshot {
  venues: Array<{ id: string; name: string; address: string; lat: number; lng: number }>;
  prices: Array<{ id: string; price: number; observedAt?: string }>;
  deals: Array<{ id: string }>;
  events: Array<{ id: string }>;
  enrichments: Array<{ id: string; value: string }>;
}

export function parseFreeMemoryPercent(output: string): number;
export function defaultMaxLoad(logicalCpuCount: number): number;
export function loadKeyFile(path: string): Record<string, string>;
export function redactSecrets(text: string, values: string[]): string;
export function keyReadinessError(
  mode: "prices" | "events",
  keys: Record<string, string | undefined>,
  dryRun?: boolean,
): string | null;
export function providerSafeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function captureRefreshSnapshot(root: string): RefreshSnapshot;
export function baseRefForRun(dryRun: boolean): "HEAD" | "origin/main";
/**
 * Runtime flags the events lane is spawned with. The lane statically imports a
 * `.ts` module, so it runs through tsx rather than depending on Node's
 * unflagged type stripping (22.18+) under an `engines` floor of 22.12.
 */
export const EVENTS_REFRESH_NODE_ARGS: string[];
/** Runtime flags needed for the Common lane's shared harvested-page fence. */
export const COMMON_REFRESH_NODE_ARGS: string[];

export type RefreshCommand = {
  executable: string;
  /** Runtime flags, spawned BEFORE `args` so `args[0]` stays the script. */
  nodeArgs?: string[];
  args: string[];
  /** A lane whose non-zero exit must not stop the others. */
  independent?: boolean;
  /** Provider keys this lane needs; absent means the lane is keyless. */
  requiresAnyKey?: string[];
};

export function commandsForMode(
  mode: "prices" | "events",
  dryRun: boolean,
): RefreshCommand[];

export function laneReadiness(
  mode: "prices" | "events",
  keys: Record<string, string | undefined>,
  dryRun?: boolean,
): { runnable: RefreshCommand[]; skipped: { command: RefreshCommand; reason: string }[] };

export function resourceRefusal(input: {
  load1: number;
  maxLoad: number;
  freeMemoryPercent: number;
  minFreeMemoryPercent: number;
}): string | null;

export function summariseRefresh(before: RefreshSnapshot, after: RefreshSnapshot): RefreshSummary;

export function renderLaunchAgents(input: {
  repoRoot: string;
  nodePath: string;
  homeDir: string;
}): Array<{ label: string; fileName: string; xml: string }>;

export function publishPreparedChanges(input: {
  worktree: string;
  mode: "prices" | "events";
  dryRun: boolean;
  summary: RefreshSummary;
  log?: (message: string) => void;
  ghAxiPath?: string;
  timestamp?: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<
  | { status: "no-change"; changedFiles: string[] }
  | { status: "dry-run"; changedFiles: string[]; diff: string }
  | { status: "published"; changedFiles: string[]; branch: string }
>;

export function runScheduledRefresh(input: {
  mode: "prices" | "events";
  dryRun?: boolean;
  repoRoot?: string;
  homeDir?: string;
  keysFile?: string;
  logDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<{
  status: string;
  reason?: string;
  logPath: string;
  summary?: RefreshSummary;
}>;

export function writeLaunchAgents(
  outputDirectory: string,
  options?: { repoRoot?: string; homeDir?: string; nodePath?: string },
): string[];

export function validatePreparedData(input: {
  worktree: string;
  environment: NodeJS.ProcessEnv;
  log: (message: string) => void;
}): Promise<void>;
