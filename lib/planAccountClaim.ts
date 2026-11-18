// One attempt to bind a host or guest Plan seat to the signed-in account.
// A lifetime is one span of the shared provider account signal.

const PLAN_ACCOUNT_CLAIM_DELAYS_MS = [0, 250, 1_000] as const;

export type PlanAccountClaimOutcome = "claimed" | "refused" | "transient";

export type PlanAccountClaimState =
  | { phase: "sending"; lifetime: number; attempt: number }
  | { phase: "waiting"; lifetime: number; attempt: number }
  | { phase: "exhausted"; lifetime: number }
  | { phase: "claimed" }
  | { phase: "refused" }
  | { phase: "stopped" };

export type PlanAccountClaimEvent =
  | { type: "answered"; lifetime: number; attempt: number; outcome: PlanAccountClaimOutcome }
  | { type: "waited"; lifetime: number; attempt: number }
  | { type: "interrupted"; lifetime: number; sameAccount: boolean }
  | { type: "resumed" }
  | { type: "disposed" };

export const INITIAL_PLAN_ACCOUNT_CLAIM: PlanAccountClaimState = { phase: "sending", lifetime: 0, attempt: 0 };

export function planAccountClaimOutcome(response: { ok: boolean; status: number } | null): PlanAccountClaimOutcome {
  if (!response || response.status === 429 || response.status === 503) return "transient";
  return response.ok ? "claimed" : "refused";
}

export function planAccountClaimDelay(attempt: number): number | undefined {
  return PLAN_ACCOUNT_CLAIM_DELAYS_MS[attempt];
}

function retry(lifetime: number, attempt: number): PlanAccountClaimState {
  const next = attempt + 1;
  const delayMs = PLAN_ACCOUNT_CLAIM_DELAYS_MS[next];
  return delayMs === undefined ? { phase: "exhausted", lifetime } : { phase: "waiting", lifetime, attempt: next };
}

export function transitionPlanAccountClaim(
  state: PlanAccountClaimState,
  event: PlanAccountClaimEvent,
): PlanAccountClaimState {
  switch (event.type) {
    case "answered": {
      if (state.phase !== "sending" || state.lifetime !== event.lifetime || state.attempt !== event.attempt) return state;
      switch (event.outcome) {
        case "claimed":
          return { phase: "claimed" };
        case "refused":
          return { phase: "refused" };
        case "transient":
          return retry(state.lifetime, state.attempt);
        default: {
          const unreachable: never = event.outcome;
          return unreachable;
        }
      }
    }
    case "waited":
      if (state.phase !== "waiting" || state.lifetime !== event.lifetime || state.attempt !== event.attempt) return state;
      return { phase: "sending", lifetime: state.lifetime, attempt: state.attempt };
    case "interrupted": {
      if (!("lifetime" in state) || state.lifetime !== event.lifetime) return state;
      if (!event.sameAccount) return { phase: "stopped" };
      const lifetime = state.lifetime + 1;
      // An exhausted claim keeps waiting for the app to return.
      return state.phase === "exhausted" ? { phase: "exhausted", lifetime } : { phase: "sending", lifetime, attempt: 0 };
    }
    case "resumed":
      return state.phase === "exhausted" ? { phase: "sending", lifetime: state.lifetime, attempt: 0 } : state;
    case "disposed":
      return "lifetime" in state ? { phase: "stopped" } : state;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
