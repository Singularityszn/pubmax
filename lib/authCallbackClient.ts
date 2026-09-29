import type { AuthCallbackTokens } from "@/lib/authRedirect";
import { isGoTrueUserBannedError } from "@/lib/authAccountBan";

export type AuthSessionEstablishClient<SessionValue> = {
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{
    data: { session: SessionValue | null };
    error: unknown;
  }>;
};

export type AuthCallbackSessionResult<SessionValue> = {
  session: SessionValue | null;
  failed: boolean;
  banned: boolean;
};

export type AuthCallbackIdentityClient = {
  getUser: (accessToken: string) => Promise<{
    data: { user: { id: string; email?: string | null } | null };
    error: unknown;
  }>;
};

export type PreparedAuthCallbackSession<SessionValue> =
  | { status: "established"; result: AuthCallbackSessionResult<SessionValue> }
  | { status: "verification-failed" }
  | {
      status: "confirmation-required";
      identity: { userId: string; label: string };
      confirm: () => Promise<AuthCallbackSessionResult<SessionValue>>;
    };

/** Verify an unowned callback with GoTrue without installing it in the live client. */
export async function prepareAuthCallbackSession<SessionValue>(
  auth: AuthSessionEstablishClient<SessionValue> & AuthCallbackIdentityClient,
  tokens: AuthCallbackTokens,
  localAttemptOwned: boolean,
): Promise<PreparedAuthCallbackSession<SessionValue>> {
  if (localAttemptOwned) {
    return {
      status: "established",
      result: await establishAuthCallbackSession(auth, tokens),
    };
  }

  try {
    const { data, error } = await auth.getUser(tokens.accessToken);
    if (error || !data.user?.id) return { status: "verification-failed" };
    const userId = data.user.id;
    const label = data.user.email?.trim() || userId;
    let inFlight: Promise<AuthCallbackSessionResult<SessionValue>> | null = null;
    return {
      status: "confirmation-required",
      identity: { userId, label },
      confirm: () => (inFlight ??= establishAuthCallbackSession(auth, tokens)),
    };
  } catch {
    return { status: "verification-failed" };
  }
}

/**
 * Establish the session from implicit-flow callback tokens. Normalizes both
 * Supabase errors and network failures for the UI, exactly like the PKCE
 * exchange this replaced.
 */
export async function establishAuthCallbackSession<SessionValue>(
  auth: AuthSessionEstablishClient<SessionValue>,
  tokens: AuthCallbackTokens,
): Promise<AuthCallbackSessionResult<SessionValue>> {
  try {
    const { data, error } = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (error) {
      return {
        session: data.session ?? null,
        failed: !isGoTrueUserBannedError(error),
        banned: isGoTrueUserBannedError(error),
      };
    }
    return { session: data.session ?? null, failed: false, banned: false };
  } catch {
    return { session: null, failed: true, banned: false };
  }
}

const PKCE_VERIFIER_KEY_SUFFIX = "-auth-token-code-verifier";

/**
 * Remove code-verifier keys left behind by the PKCE flow this app used before
 * the implicit flow. supabase-js stores them as sb-<ref>-auth-token-code-verifier
 * and the implicit flow never reads or clears them, so a browser that started a
 * PKCE attempt keeps a dead one-time secret in localStorage until this runs.
 * The stored session key (sb-<ref>-auth-token) is live state and is kept.
 */
export function clearLegacyPkceVerifiers(
  storage: Pick<Storage, "length" | "key" | "removeItem"> | null,
): void {
  if (!storage) return;
  try {
    const staleKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith("sb-") && key.endsWith(PKCE_VERIFIER_KEY_SUFFIX)) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) storage.removeItem(key);
  } catch {
    // Best-effort cleanup; a leftover verifier is inert under the implicit flow.
  }
}
