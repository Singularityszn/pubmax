import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  AUTH_ATTEMPT_PARAM,
  AUTH_CALLBACK_MARKER,
  REFERRAL_SIGNUP_PROOF_PARAM,
  captureAuthCallback,
  safeAuthNext,
  type AuthAttemptStart,
  type AuthCallbackCaptureOptions,
  type CapturedAuthCallback,
} from "@/lib/authRedirect";
import { isAuthUserBannedUntil } from "@/lib/authAccountBan";
import { createNativeAuthClient } from "@/lib/nativeAuthClient";
import { IOS_AUTH_MODE, readNativeAuthCallback } from "@/lib/nativeAuthCallback";
import { authenticateNativeSession } from "@/lib/nativeAuthSession";

type Auth = SupabaseClient["auth"];
type NativeClient = { auth: Pick<Auth, "signInWithOAuth" | "exchangeCodeForSession" | "getUser" | "stopAutoRefresh"> };
type Installation = Awaited<ReturnType<Auth["setSession"]>>;
export type NativeIOSOAuthDeps = {
  createClient?: (attemptId: string) => Promise<NativeClient | null>;
  authenticate?: typeof authenticateNativeSession;
  claim?: (url: string) => Promise<CapturedAuthCallback | null>;
  ownership: AuthCallbackCaptureOptions;
  current: () => boolean;
  install: (session: Session) => Promise<Installation | null>;
};

export function nativeAuthLandingUrl(callbackUrl: string): string {
  const callback = new URL(callbackUrl);
  const landing = new URL(safeAuthNext(callback.searchParams.get("next"), callback.origin), callback.origin);
  landing.searchParams.set(AUTH_CALLBACK_MARKER, "1");
  landing.searchParams.set(AUTH_ATTEMPT_PARAM, callback.searchParams.get(AUTH_ATTEMPT_PARAM) ?? "");
  const proof = callback.searchParams.get(REFERRAL_SIGNUP_PROOF_PARAM);
  if (proof) landing.searchParams.set(REFERRAL_SIGNUP_PROOF_PARAM, proof);
  return landing.toString();
}

/** Refuse expired or near-expiry tokens before canonical setSession can enter its refresh path. */
export function nativeSessionCanInstall(session: Session, now = Date.now()): boolean {
  try {
    const payload = session.access_token.split(".")[1];
    if (!payload || !session.refresh_token) return false;
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    // setSession refreshes an expired replacement token and may clear the existing account on refusal.
    return typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp > now / 1000 + 60;
  } catch { return false; }
}

/** Native provider sign-in establishes a signed-out account. Existing accounts use Switch account. */
export async function installNativeSession(
  auth: Pick<Auth, "getSession" | "setSession">,
  session: Session,
  current: () => boolean,
): Promise<Installation | null> {
  const active = await auth.getSession();
  if (active.error || active.data.session || !current()) return null;
  return auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
}

/** Exchange in the original PKCE client, verify remotely, then install through the canonical client. */
export async function completeNativeIOSOAuth(
  provider: "google" | "apple" | "azure",
  attempt: Extract<AuthAttemptStart, { ok: true }>,
  deps: NativeIOSOAuthDeps,
): Promise<{ session: Session; captured: CapturedAuthCallback } | null> {
  let client: NativeClient | null = null;
  let captured: CapturedAuthCallback | null = null;
  try {
    client = await (deps.createClient ?? createNativeAuthClient)(attempt.id);
    if (!client || !deps.current()) return null;
    const redirect = new URL(attempt.callbackUrl);
    redirect.searchParams.set("native", IOS_AUTH_MODE);
    const started = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirect.toString(), skipBrowserRedirect: true,
        ...(provider === "azure" ? { scopes: "email openid profile" } : {}),
      },
    });
    if (started.error || !started.data.url || !deps.current()) return null;
    const returned = await (deps.authenticate ?? authenticateNativeSession)({ url: started.data.url, attemptId: attempt.id });
    if (!deps.current()) return null;
    const code = readNativeAuthCallback(returned.url, attempt.id);
    if (!code) return null;
    const landing = nativeAuthLandingUrl(attempt.callbackUrl);
    captured = await (deps.claim ?? ((url) => captureAuthCallback(url, deps.ownership)))(landing);
    if (!captured?.localAttemptOwned || !deps.current()) return null;
    const exchanged = await client.auth.exchangeCodeForSession(code);
    const session = exchanged.data.session;
    if (exchanged.error || !session || !deps.current()) return null;
    const verified = await client.auth.getUser(session.access_token);
    if (verified.error || verified.data.user?.id !== session.user.id ||
        isAuthUserBannedUntil(verified.data.user as { banned_until?: string | null }) ||
        !nativeSessionCanInstall(session) || !deps.current()) return null;
    const installed = await deps.install(session);
    if (!installed || installed.error || installed.data.session?.user.id !== verified.data.user.id) return null;
    return { session: installed.data.session, captured };
  } catch {
    return null;
  } finally {
    captured?.releaseCoordination();
    try { await client?.auth.stopAutoRefresh(); } catch { /* The disposable client cannot refresh or persist a session. */ }
  }
}
