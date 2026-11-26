import { MAX_DEVICE_ACCOUNTS } from "@/lib/deviceAccountSessions";

/** A Sign in with Apple token that account deletion can revoke. Apple's revoke endpoint takes either kind. */
export type AppleToken = { value: string; type: "refresh_token" | "access_token" };

const MAX_TOKEN_LENGTH = 4096;

function plausibleAppleToken(value: unknown): value is string {
  return typeof value === "string" && !!value && value.length <= MAX_TOKEN_LENGTH && !/\s/.test(value);
}

/** The `appleToken` a `DELETE /api/account` body carries, or null for any other shape. */
export function appleTokenFromBody(body: unknown): AppleToken | null {
  if (!body || typeof body !== "object") return null;
  const token = (body as { appleToken?: unknown }).appleToken;
  if (!token || typeof token !== "object") return null;
  const { value, type } = token as { value?: unknown; type?: unknown };
  if (type !== "refresh_token" && type !== "access_token") return null;
  if (!plausibleAppleToken(value)) return null;
  return { value, type };
}

// Supabase hands Apple's refresh token to the client once, in the sign-in
// return, and drops it at the first session refresh. This device keeps it,
// per account, so account deletion can send it to Apple's revoke endpoint.
// Alone it can neither mint a token nor revoke one: both need the client
// secret, which only the server holds.

type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type KeptToken = { userId: string; value: string };

const APPLE_SIGN_IN_TOKENS_KEY = "pubmax_apple_sign_in_tokens_v1";
const APPLE_SIGN_IN_ATTEMPT_KEY = "pubmax_apple_sign_in_attempt_v1";

function readKept(storage: DeviceStorage | null): KeptToken[] {
  try {
    const rows: unknown = JSON.parse(storage?.getItem(APPLE_SIGN_IN_TOKENS_KEY) ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is KeptToken =>
      !!row && typeof row === "object" &&
      typeof (row as KeptToken).userId === "string" && !!(row as KeptToken).userId &&
      plausibleAppleToken((row as KeptToken).value));
  } catch {
    return [];
  }
}

function writeKept(storage: DeviceStorage | null, rows: KeptToken[]): void {
  try {
    if (rows.length === 0) storage?.removeItem(APPLE_SIGN_IN_TOKENS_KEY);
    else storage?.setItem(APPLE_SIGN_IN_TOKENS_KEY, JSON.stringify(rows.slice(-MAX_DEVICE_ACCOUNTS)));
  } catch {
    // Blocked storage keeps no token. Deletion then logs `no_token`.
  }
}

/**
 * Keep the provider's refresh token for the account that just signed in, only
 * when that sign-in went to Apple. A Google or Microsoft token is never kept.
 */
export function keepAppleSignInToken(
  storage: DeviceStorage | null,
  signIn: { provider: "apple" | "google" | "azure" | null; userId: string; refreshToken: string | null | undefined },
): void {
  const { provider, userId, refreshToken } = signIn;
  if (provider !== "apple" || !userId || !plausibleAppleToken(refreshToken)) return;
  writeKept(storage, readKept(storage).filter((row) => row.userId !== userId).concat({ userId, value: refreshToken }));
}

/** The Apple token this device keeps for the account, or null. */
export function keptAppleSignInToken(storage: DeviceStorage | null, userId: string): AppleToken | null {
  const row = readKept(storage).find((kept) => kept.userId === userId);
  return row ? { value: row.value, type: "refresh_token" } : null;
}

/** One account leaves this device: its Apple token goes with it. */
export function forgetAppleSignInToken(storage: DeviceStorage | null, userId: string): void {
  writeKept(storage, readKept(storage).filter((row) => row.userId !== userId));
}

/** Every account leaves this device. */
export function forgetAllAppleSignInTokens(storage: DeviceStorage | null): void {
  writeKept(storage, []);
}

/** Web: this sign-in attempt goes to Apple. The return reads it with `webSignInProvider`. */
export function markAppleSignInAttempt(storage: DeviceStorage | null, attemptId: string): void {
  try {
    storage?.setItem(APPLE_SIGN_IN_ATTEMPT_KEY, attemptId);
  } catch {
    // Without the mark the return keeps no token. Sign-in itself is unaffected.
  }
}

/**
 * Web return: "apple" only when this browser started and claimed this attempt
 * and sent it to Apple. The web return does not name its provider, so the mark
 * made at the start is the proof. A match spends the mark. Attempt ids are
 * single use, so a mark left by an abandoned attempt matches nothing.
 */
export function webSignInProvider(
  storage: DeviceStorage | null,
  captured: { attempt: { attemptId: string | null }; localAttemptOwned: boolean },
): "apple" | null {
  try {
    const { attemptId } = captured.attempt;
    if (!captured.localAttemptOwned || !attemptId || storage?.getItem(APPLE_SIGN_IN_ATTEMPT_KEY) !== attemptId) return null;
    storage?.removeItem(APPLE_SIGN_IN_ATTEMPT_KEY);
    return "apple";
  } catch {
    return null;
  }
}

/** The `DELETE /api/account` request, carrying the Apple token this device keeps for the account. */
export function accountDeletionRequestInit(storage: DeviceStorage | null, userId: string): RequestInit {
  const appleToken = keptAppleSignInToken(storage, userId);
  if (!appleToken) return { method: "DELETE" };
  return {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appleToken }),
  };
}
