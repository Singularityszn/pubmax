import type { AuthCallbackTokens } from "@/lib/authRedirect";
import { isGoTrueUserBannedError } from "@/lib/authAccountBan";
import type { MintOutcome } from "@/lib/deviceAccountSwitch";

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

/** Verify the refresh identity and compare any valid access identity before consent. */
export async function prepareAuthCallbackSession<SessionValue>(
  auth: AuthSessionEstablishClient<SessionValue> & AuthCallbackIdentityClient,
  tokens: AuthCallbackTokens,
  localAttemptOwned: boolean,
  mintSession: (refreshToken: string) => Promise<MintOutcome>,
): Promise<PreparedAuthCallbackSession<SessionValue>> {
  if (localAttemptOwned) {
    return {
      status: "established",
      result: await establishAuthCallbackSession(auth, tokens),
    };
  }

  try {
    // A cross-browser email link can reach this tab after its original access
    // token expires. Treat a failed access read as unknown, never as identity.
    const original = await auth.getUser(tokens.accessToken).catch(() => null);
    const originalUserId = original && !original.error ? original.data.user?.id : null;
    // GoTrue's setSession verifies the access token but keeps the supplied
    // refresh token untouched while access is live. Once access expires it
    // instead installs the refresh token's identity. Mint through a plain
    // request first, then verify the fresh pair's access identity. When both
    // identities are verifiable they must agree.
    const minted = await mintSession(tokens.refreshToken);
    if (minted.status !== "minted") return { status: "verification-failed" };
    const refreshed = await auth.getUser(minted.session.access_token);
    const userId = refreshed.data.user?.id;
    if (refreshed.error || !userId || (originalUserId && originalUserId !== userId)) {
      return { status: "verification-failed" };
    }
    const label = refreshed.data.user?.email?.trim() || userId;
    const verifiedTokens = {
      accessToken: minted.session.access_token,
      refreshToken: minted.session.refresh_token,
    };
    let inFlight: Promise<AuthCallbackSessionResult<SessionValue>> | null = null;
    return {
      status: "confirmation-required",
      identity: { userId, label },
      confirm: () => (inFlight ??= establishAuthCallbackSession(auth, verifiedTokens)),
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
