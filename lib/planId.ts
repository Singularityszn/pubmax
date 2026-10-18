// The plan id shape, with nothing behind it.
//
// Sign-in reads this to accept a /plan/<id> return address, and sign-in rides
// the root shell on every route. Asked of lib/plan.ts it took the whole planner
// with it (night planning, the night areas and their city pack), so the check
// lives here and lib/plan.ts re-exports it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPlanId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
