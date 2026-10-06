/**
 * Telling Vercel's edge firewall apart from the app, and riding out a 429.
 *
 * On 6 Oct 2026 the smoke run's save journey failed with a 429 that never
 * reached a function. The response carried `x-vercel-mitigated: deny`, which
 * only the platform sets: the app's own RATE_LIMITED answer has no such header.
 * Reading that as an app defect sent the investigation into the code for a
 * failure that lived in the infrastructure, so this module gives the run two
 * rules:
 *
 *  1. A 429 is retried with a growing pause, because a mitigation lifts after a
 *     few seconds and a smoke run exists to prove the journeys, not to race a
 *     limiter.
 *  2. A deny that outlasts the retries is reported as its own failure, named as
 *     infrastructure, never as a failed assertion about the page.
 *
 * Nothing here touches Playwright at runtime, so the policy is unit-testable.
 */

/** The header Vercel sets on a response its firewall answered. */
export const FIREWALL_HEADER = "x-vercel-mitigated";

/** Pauses before each retry of a 429: 2 s, 4 s, 8 s, then give up. */
export const FIREWALL_BACKOFF_MS = [2_000, 4_000, 8_000] as const;

type HeaderReader = { [name: string]: string | undefined } | Headers;

function header(headers: HeaderReader, name: string): string | undefined {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const bag = headers as { [name: string]: string | undefined };
  const key = Object.keys(bag).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : bag[key];
}

/** Did the platform's firewall, rather than the app, refuse this response? */
export function isFirewallDeny(response: { status: number; headers: HeaderReader }): boolean {
  const mitigated = header(response.headers, FIREWALL_HEADER);
  return response.status === 429 && mitigated !== undefined && mitigated !== "";
}

/** Is this a refusal worth another try: any 429, the platform's or the app's. */
export function isRetryable429(response: { status: number }): boolean {
  return response.status === 429;
}

/** A deny that the retries did not clear. Names the infrastructure, not the page. */
export class FirewallDenyError extends Error {
  readonly url: string;
  readonly attempts: number;

  constructor(url: string, attempts: number) {
    super(
      `INFRASTRUCTURE: Vercel's edge firewall denied ${url} on ${attempts} attempts ` +
        `(${FIREWALL_HEADER} header present). The app did not answer. This is not a ` +
        `page failure: see docs in e2e/prod-smoke/README.md before reading it as one.`,
    );
    this.name = "FirewallDenyError";
    this.url = url;
    this.attempts = attempts;
  }
}

type Answer = { status: number; headers: HeaderReader; url: string };

/**
 * Run `attempt` until it stops answering 429, pausing between tries. `describe`
 * reads the status, headers and URL off whatever `attempt` returns, because
 * Playwright's APIResponse and a fetch Response expose them differently.
 *
 * Resolves with the first answer that is not a 429. When every try is a 429 it
 * throws `FirewallDenyError` if the last was the platform's deny, and otherwise
 * returns that last answer so the caller's own assertion reports the app's 429.
 */
export async function untilNot429<T>(
  attempt: () => Promise<T>,
  describe: (value: T) => Answer,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  backoffMs: readonly number[] = FIREWALL_BACKOFF_MS,
): Promise<T> {
  let value = await attempt();
  for (const pause of backoffMs) {
    if (!isRetryable429(describe(value))) return value;
    await sleep(pause);
    value = await attempt();
  }
  const last = describe(value);
  if (isFirewallDeny(last)) throw new FirewallDenyError(last.url, backoffMs.length + 1);
  return value;
}

/**
 * Run a journey step that drives the page, and repeat the WHOLE step when a
 * response seen while it ran was a firewall deny. `denies` reports how many
 * denies the page has seen so far; the step is repeated only when that count
 * rose during it. A step that fails for any other reason is not retried.
 */
export async function untilNoFirewallDeny<T>(
  step: () => Promise<T>,
  denies: () => number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  backoffMs: readonly number[] = FIREWALL_BACKOFF_MS,
  label = "step",
): Promise<T> {
  for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
    const before = denies();
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await step() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    const denied = denies() > before;
    if (!denied) {
      if (outcome.ok) return outcome.value;
      throw outcome.error;
    }
    if (attempt === backoffMs.length) throw new FirewallDenyError(label, attempt + 1);
    await sleep(backoffMs[attempt] ?? 0);
  }
  throw new FirewallDenyError(label, backoffMs.length + 1);
}
