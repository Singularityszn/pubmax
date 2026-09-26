/** How long after an account's first verification its sign-in still counts as the sign-up. */
const USER_SIGNED_UP_WINDOW_MS = 5 * 60_000;

/**
 * Whether a SIGNED_IN is the account's sign-up. Anchored on `confirmed_at`,
 * which Supabase sets at the first successful verification, never on
 * `created_at`: an email link creates the user when it is REQUESTED, so a
 * reader who opens it seven minutes later would never count as signed up.
 */
export function isUserSignUp(
  user: { confirmed_at?: string | null },
  now: number,
): boolean {
  const confirmedAt = Date.parse(user.confirmed_at ?? "");
  return Number.isFinite(confirmedAt) && now - confirmedAt < USER_SIGNED_UP_WINDOW_MS;
}
