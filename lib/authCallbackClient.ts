import type { AuthCallbackTokens } from "@/lib/authRedirect";
import { isGoTrueUserBannedError } from "@/lib/authAccountBan";
import { withAuthFetchTimeout } from "@/lib/authFetch";
import type { DeviceAccountSwitchDeps, MintOutcome } from "@/lib/deviceAccountSwitch";

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

type AuthCallbackUserLookup = (accessToken: string) => Promise<{
  data: { user: { id: string; email?: string | null } | null };
  error: unknown;
}>;

export async function fetchAuthCallbackUser(
  accessToken: string,
  deps: Pick<DeviceAccountSwitchDeps, "fetchImpl" | "authConfig">,
): ReturnType<AuthCallbackUserLookup> {
  if (!deps.authConfig) return { data: { user: null }, error: new Error("Auth unavailable") };
  const response = await withAuthFetchTimeout(deps.fetchImpl)(
    new URL("/auth/v1/user", deps.authConfig.url).toString(),
    {
      headers: {
        apikey: deps.authConfig.key,
        authorization: `Bearer ${accessToken}`,
        "x-supabase-api-version": "2024-01-01",
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    },
  );
  const body = await response.json();
  if (!response.ok) {
    return {
      data: { user: null },
      error: {
        status: response.status,
        code: body?.code,
        message: body?.msg ?? body?.message,
      },
    };
  }
  if (typeof body?.id !== "string" || !body.id) {
    return { data: { user: null }, error: new Error("Invalid identity") };
  }
  return {
    data: { user: {
      id: body.id,
      email: typeof body.email === "string" ? body.email : null,
    } },
    error: null,
  };
}

function expiredCallbackSubject(error: unknown, accessToken: string): string | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as { status?: unknown; code?: unknown; message?: unknown };
  if (
    failure.status !== 403 || failure.code !== "bad_jwt" ||
    failure.message !== "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired"
  ) return null;
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims?.sub === "string" && claims.sub &&
      typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.sub : null;
  } catch {
    return null;
  }
}

export type PreparedAuthCallbackSession<SessionValue> =
  | { status: "established"; result: AuthCallbackSessionResult<SessionValue> }
  | { status: "verification-failed" }
  | { status: "banned" }
  | {
      status: "confirmation-required";
      identity: { userId: string; label: string };
      confirm: () => Promise<AuthCallbackSessionResult<SessionValue>>;
    };

export async function prepareAuthCallbackSession<SessionValue>(
  auth: AuthSessionEstablishClient<SessionValue>,
  tokens: AuthCallbackTokens,
  localAttemptOwned: boolean,
  mintSession: (refreshToken: string) => Promise<MintOutcome>,
  getUser: AuthCallbackUserLookup,
): Promise<PreparedAuthCallbackSession<SessionValue>> {
  if (localAttemptOwned) {
    return {
      status: "established",
      result: await establishAuthCallbackSession(auth, tokens),
    };
  }

  try {
    const original = await getUser(tokens.accessToken);
    if (isGoTrueUserBannedError(original.error)) return { status: "banned" };
    const originalUserId = original.error
      ? expiredCallbackSubject(original.error, tokens.accessToken)
      : original.data.user?.id;
    if (!originalUserId) return { status: "verification-failed" };
    const minted = await mintSession(tokens.refreshToken);
    if (minted.status === "refused" && minted.banned) return { status: "banned" };
    if (minted.status !== "minted") return { status: "verification-failed" };
    const refreshed = await getUser(minted.session.access_token);
    if (isGoTrueUserBannedError(refreshed.error)) return { status: "banned" };
    const userId = refreshed.data.user?.id;
    if (refreshed.error || !userId || originalUserId !== userId) {
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
