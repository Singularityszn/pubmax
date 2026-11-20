import type { PaydayConsentEvent, PaydayConsentState } from "@/lib/paydayPintConsent";

const pending = { phase: "pending" } as const;
const confirmed = { phase: "confirmed", consentAt: "2026-11-01T00:00:00.000Z", confirmedAt: "2026-11-01T01:00:00.000Z" } as const;
const withdrawn = { ...confirmed, phase: "withdrawn", withdrawnAt: "2026-11-01T02:00:00.000Z" } as const;
const later = { phase: "confirmed", consentAt: "2026-11-01T03:00:00.000Z", confirmedAt: "2026-11-01T04:00:00.000Z" } as const;
const confirm = (requestedAt: string = later.consentAt, now: string = later.confirmedAt): PaydayConsentEvent => ({ type: "confirm", requestedAt, now });
const withdraw = (now: string): PaydayConsentEvent => ({ type: "withdraw", now });

// Oracle: double opt-in expires after 48 hours. New consent must follow both
// the last accepted consent and withdrawal. Withdrawal time never decreases.
export const paydayConsentCases: { name: string; state: PaydayConsentState; event: PaydayConsentEvent; expected: PaydayConsentState; accepted: boolean }[] = [
  { name: "pending confirmation", state: pending, event: confirm(), expected: later, accepted: true },
  { name: "confirmation at expiry", state: pending, event: confirm(confirmed.consentAt, "2026-11-03T00:00:00.000Z"), expected: { ...confirmed, confirmedAt: "2026-11-03T00:00:00.000Z" }, accepted: true },
  { name: "confirmation past expiry", state: pending, event: confirm(confirmed.consentAt, "2026-11-03T00:00:00.001Z"), expected: pending, accepted: false },
  { name: "newer confirmed signup", state: confirmed, event: confirm(), expected: later, accepted: true },
  { name: "same confirmed signup", state: confirmed, event: confirm(confirmed.consentAt), expected: confirmed, accepted: false },
  { name: "older confirmed signup with an offset", state: confirmed, event: confirm("2026-11-01T01:00:00+02:00"), expected: confirmed, accepted: false },
  { name: "expired replacement", state: confirmed, event: confirm(later.consentAt, "2026-11-04T00:00:00.000Z"), expected: confirmed, accepted: false },
  { name: "renewal after withdrawal", state: withdrawn, event: confirm(), expected: later, accepted: true },
  { name: "signup before withdrawal", state: withdrawn, event: confirm(confirmed.confirmedAt), expected: withdrawn, accepted: false },
  { name: "signup at withdrawal", state: withdrawn, event: confirm(withdrawn.withdrawnAt), expected: withdrawn, accepted: false },
  { name: "signup older than accepted consent", state: withdrawn, event: confirm("2026-10-31T23:00:00.000Z"), expected: withdrawn, accepted: false },
  { name: "expired renewal", state: withdrawn, event: confirm(later.consentAt, "2026-11-04T00:00:00.000Z"), expected: withdrawn, accepted: false },
  { name: "withdrawal without a subscriber", state: pending, event: withdraw(withdrawn.withdrawnAt), expected: pending, accepted: false },
  { name: "first withdrawal", state: confirmed, event: withdraw(withdrawn.withdrawnAt), expected: withdrawn, accepted: true },
  { name: "later repeated withdrawal", state: withdrawn, event: withdraw(later.confirmedAt), expected: { ...withdrawn, withdrawnAt: later.confirmedAt }, accepted: true },
  { name: "same repeated withdrawal", state: withdrawn, event: withdraw(withdrawn.withdrawnAt), expected: withdrawn, accepted: false },
  { name: "older repeated withdrawal", state: withdrawn, event: withdraw(confirmed.confirmedAt), expected: withdrawn, accepted: false },
];
