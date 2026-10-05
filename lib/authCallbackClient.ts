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

type AuthCallbackUser = {
  id: string;
  email?: string | null;
  emailConfirmedAt?: string | null;
};

type AuthCallbackUserLookup = (accessToken: string) => Promise<{
  data: { user: AuthCallbackUser | null };
  error: unknown;
}>;

/** A verified email, otherwise no label. An unverified email is one the sender of the link can choose. */
export function authCallbackConfirmationLabel(user: AuthCallbackUser): string | null {
  const email = user.email?.trim() ?? "";
  const confirmed =
    typeof user.emailConfirmedAt === "string" && user.emailConfirmedAt.trim().length > 0;
  return email && confirmed ? email : null;
}

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
  const emailConfirmedAt =
    typeof body.email_confirmed_at === "string" && body.email_confirmed_at.trim()
      ? body.email_confirmed_at
      : null;
  return {
    data: { user: {
      id: body.id,
      email: typeof body.email === "string" ? body.email : null,
      emailConfirmedAt,
    } },
    error: null,
  };
}

/** Decoded, NOT verified, access token claims. Callers verify the token with GoTrue. */
function accessTokenClaims(accessToken: string): Record<string, unknown> | null {
  try {
    const parts = accessToken.split(".");
    const payload = parts[1];
    if (parts.length !== 3 || payload === undefined) return null;
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return claims && typeof claims === "object" ? claims as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function expiredCallbackSubject(error: unknown, accessToken: string): string | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as { status?: unknown; code?: unknown; message?: unknown };
  if (
    failure.status !== 403 || failure.code !== "bad_jwt" ||
    failure.message !== "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired"
  ) return null;
  const claims = accessTokenClaims(accessToken);
  return typeof claims?.sub === "string" && claims.sub &&
    typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.sub : null;
}

/**
 * GoTrue `amr` methods of an emailed sign-in link. Only an emailed link can
 * honestly land in a browser that never started the attempt. OAuth and a
 * password always return to the browser that started them, so an unowned
 * callback carrying one is somebody else's session handed over in a link.
 */
// A first sign-up confirmation link is an emailed link too.
const EMAIL_LINK_AMR_METHODS = new Set(["otp", "magiclink", "email/signup"]);

function isEmailLinkSession(accessToken: string): boolean {
  const amr = accessTokenClaims(accessToken)?.amr;
  return Array.isArray(amr) && amr.some((entry: unknown) => {
    const method = entry && typeof entry === "object" ? (entry as { method?: unknown }).method : null;
    return typeof method === "string" && EMAIL_LINK_AMR_METHODS.has(method);
  });
}

export type PreparedAuthCallbackSession<SessionValue> =
  | { status: "established"; result: AuthCallbackSessionResult<SessionValue> }
  | { status: "verification-failed" }
  | { status: "banned" }
  | {
      status: "confirmation-required";
      identity: { userId: string; label: string | null };
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
    // GoTrue just verified this minted token for the same account, so its
    // claims are its own. Refresh keeps the session's original amr.
    if (!isEmailLinkSession(minted.session.access_token)) {
      return { status: "verification-failed" };
    }
    const label = authCallbackConfirmationLabel(refreshed.data.user ?? { id: userId });
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
