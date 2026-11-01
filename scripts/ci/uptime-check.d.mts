/** Wait between the first ask and the second, in milliseconds. */
export const UPTIME_RETRY_DELAY_MS: number;

/** How long one ask may take, body included, in milliseconds. */
export const UPTIME_REQUEST_TIMEOUT_MS: number;

/** The user agent every ask sends. */
export const UPTIME_USER_AGENT: string;

export type UptimeProbe = {
  readonly path: string;
  /** Null for a good answer, otherwise the reason it is not one. */
  judge(body: unknown): string | null;
};

/** The two routes, and what a good answer from each one says. */
export const UPTIME_PROBES: readonly UptimeProbe[];

export type UptimeAnswer = {
  path: string;
  up: boolean;
  status: number | null;
  ms: number;
  reason?: string;
  deploymentId?: string | null;
};

export type UptimeEntry = {
  path: string;
  first: UptimeAnswer;
  retry: UptimeAnswer | null;
  state: "up" | "flap" | "down";
};

export type UptimeDeps = {
  origin?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  timeoutMs?: number;
  now?: () => number;
};

export function probeOnce(
  probe: UptimeProbe,
  deps: { origin: string; fetchImpl: typeof fetch; timeoutMs: number; now: () => number },
): Promise<UptimeAnswer>;

export function checkUptime(deps?: UptimeDeps): Promise<UptimeEntry[]>;

export function reportUptime(
  entries: UptimeEntry[],
  options?: { origin?: string; retryDelayMs?: number },
): { lines: string[]; exitCode: 0 | 1 };

export function runUptimeCheck(deps?: UptimeDeps & { log?: (line: string) => void }): Promise<0 | 1>;
