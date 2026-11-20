export const PAYDAY_CONFIRMATION_LIFETIME_MS = 48 * 60 * 60 * 1000;

export type PaydayConsentState =
  | { phase: "pending" }
  | { phase: "confirmed"; consentAt: string; confirmedAt: string }
  | { phase: "withdrawn"; consentAt: string; confirmedAt: string; withdrawnAt: string };

export type PaydayConsentEvent =
  | { type: "confirm"; requestedAt: string; now: string }
  | { type: "withdraw"; now: string };

const PAYDAY_CONSENT_TRANSITIONS = {
  confirm: ["pending", "confirmed", "withdrawn"],
  withdraw: ["confirmed", "withdrawn"],
} as const satisfies Record<PaydayConsentEvent["type"], readonly PaydayConsentState["phase"][]>;

export function transitionPaydayConsent(state: PaydayConsentState, event: PaydayConsentEvent): PaydayConsentState {
  const allowed: readonly PaydayConsentState["phase"][] = PAYDAY_CONSENT_TRANSITIONS[event.type];
  if (!allowed.includes(state.phase)) return state;
  switch (event.type) {
    case "confirm": {
      const requestedAt = Date.parse(event.requestedAt);
      if (Date.parse(event.now) > requestedAt + PAYDAY_CONFIRMATION_LIFETIME_MS) return state;
      if (state.phase !== "pending" && (Date.parse(state.consentAt) >= requestedAt
        || (state.phase === "withdrawn" && Date.parse(state.withdrawnAt) >= requestedAt))) return state;
      return { phase: "confirmed", consentAt: event.requestedAt, confirmedAt: event.now };
    }
    case "withdraw":
      if (state.phase === "pending" || (state.phase === "withdrawn" && Date.parse(state.withdrawnAt) >= Date.parse(event.now))) return state;
      return { phase: "withdrawn", consentAt: state.consentAt, confirmedAt: state.confirmedAt, withdrawnAt: event.now };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
