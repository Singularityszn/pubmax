/**
 * A CEILING NO HEADER CAN WIDEN.
 *
 * Paid routes carry a deployment-wide spend ceiling: `/api/ask`, `/api/heritage`,
 * and plan generation call OpenRouter when keyed; signed-in `/api/pub-pal/chat`
 * opens an ElevenLabs conversation when keyed, and `/api/pub-pal/voice-token`
 * issues the signed voice session the same provider bills by the minute. Plan
 * generation additionally spends the routing budget. Each was rate-limited on
 * the hashed caller address ALONE, so the budget an attacker got was the budget
 * they chose: a different `x-forwarded-for` value is a different bucket, and
 * 200 values are 200 budgets. `lib/clientIpTrust.ts` closes the header half of
 * that, but a rule about which header to read is still a rule about one signal.
 * This module is the other half, and it is the load-bearing one: ONE ceiling per
 * lane for the WHOLE deployment, keyed on the lane and nothing else, so no
 * header, address, account or body can widen it.
 *
 * FOUR rules.
 *
 * (1) THE LANES ARE A CLOSED SET. `PAID_SPEND_LANES` is every route that may
 *     spend, so a fifth paid route is a row here rather than a fifth opinion,
 *     and `__tests__/anonymousPaidRoutes.test.ts` imports every API route,
 *     requires a no-session probe for each one that loads a paid client, and
 *     fails when a probe reaches a paid provider.
 *
 * (2) IT RIDES THE LIMITER THAT IS ALREADY DEPLOYED. The budget is spent through
 *     the durable `check_rate_limit` RPC of migration 0003, with an IP-free key
 *     and a rolling 24 hour window. That is deliberate: a counter table would
 *     store the tally more cheaply, but it would be a migration, and a migration
 *     the captain has not applied yet is a hole that stays open until they do.
 *     This fix is live the moment the code deploys. The cost of riding the older
 *     shape is one array of at most `budget` timestamps on one row, which is why
 *     the ceilings below are sized in the low thousands rather than left open;
 *     a lane that ever needs a six-figure ceiling is the day to add the counter.
 *
 * (3) IT FAILS CLOSED. The per-lane consumption passes `failClosed`, so a
 *     configured Supabase whose limiter cannot answer refuses rather than
 *     dropping to a per-instance budget an attacker can multiply by cold starts.
 *     Keyless (no Supabase at all) keeps the in-memory budget, which is the dev
 *     and e2e posture and spends no money either way.
 *
 * (4) A CEILING IS OPERABLE. Each lane reads one environment override, so a
 *     launch night can raise or drop a ceiling without a deploy, and 0 is a
 *     legitimate value: it is the kill switch for one paid lane.
 *
 * A pure leaf: policy, names and copy only. The consumption is
 * `lib/paidSpendBudget.server.ts`.
 */

/** Every route that may spend money. */
export const PAID_SPEND_LANES = [
  "ask",
  "heritage",
  "pub-pal-chat",
  "pub-pal-voice",
  "plan-generate",
  "typesafe",
] as const;

export type PaidSpendLane = (typeof PAID_SPEND_LANES)[number];

/** Rolling window the ceiling covers. A rolling day, so midnight is not a burst. */
export const PAID_SPEND_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Calls each lane may make in one rolling day across the WHOLE deployment.
 * Generous against real use and small against a script: `/api/ask` at 1,000 is
 * a call every 86 seconds sustained, well past anything this city produces, and
 * far below what a scripted flood would spend in an hour.
 */
export const PAID_SPEND_DEFAULT_DAILY_BUDGET: Record<PaidSpendLane, number> = {
  ask: 1_000,
  heritage: 1_000,
  "pub-pal-chat": 2_000,
  // Signed voice sessions. Each is real ElevenLabs minutes, capped per account at
  // a monthly allowance but never across accounts until this ceiling.
  "pub-pal-voice": 200,
  "plan-generate": 1_000,
  typesafe: 5_000,
};

/** One sentence for every lane, so a refusal cannot say which lane it was. */
export const PAID_SPEND_REFUSAL_LINE = "We have answered as much as we can today.";

/** One code, read by every caller and by the route tests. */
export const PAID_SPEND_REFUSAL_CODE = "DAILY_BUDGET_SPENT";

/**
 * The durable limiter key. It names the lane and NOTHING else: no address, no
 * account, no day stamp. The rolling window does the ageing, and a key carrying
 * anything a caller controls would be a budget the caller chose.
 */
export function paidSpendBudgetKey(lane: PaidSpendLane): string {
  return `paid-spend:${lane}`;
}

/** The environment name that overrides one lane's ceiling. */
export function paidSpendBudgetEnvName(lane: PaidSpendLane): string {
  return `PUBMAX_PAID_SPEND_BUDGET_${lane.toUpperCase().replaceAll("-", "_")}`;
}

/**
 * The ceiling in force for one lane. An override must be a whole number that is
 * zero or more; anything else is not an instruction, so the default stands
 * rather than a typo silently opening or closing a paid route.
 */
export function paidSpendDailyBudget(
  lane: PaidSpendLane,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[paidSpendBudgetEnvName(lane)]?.trim();
  if (!raw) return PAID_SPEND_DEFAULT_DAILY_BUDGET[lane];
  if (!/^\d+$/.test(raw)) return PAID_SPEND_DEFAULT_DAILY_BUDGET[lane];
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : PAID_SPEND_DEFAULT_DAILY_BUDGET[lane];
}

/**
 * Tavily `/extract` calls from harvest CLIs (chain menu markdown). Not a route
 * lane: nothing in `PAID_SPEND_LANES` spends it, and the cap is per run rather
 * than deployment-wide.
 */
export const TAVILY_HARVEST_DEFAULT_EXTRACT_CAP = 200;

export function tavilyHarvestExtractEnvName(): string {
  return "PUBMAX_PAID_SPEND_BUDGET_TAVILY";
}

export function tavilyHarvestExtractCap(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[tavilyHarvestExtractEnvName()]?.trim();
  if (!raw) return TAVILY_HARVEST_DEFAULT_EXTRACT_CAP;
  if (!/^\d+$/.test(raw)) return TAVILY_HARVEST_DEFAULT_EXTRACT_CAP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : TAVILY_HARVEST_DEFAULT_EXTRACT_CAP;
}
