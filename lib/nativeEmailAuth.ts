import type { Session } from "@supabase/supabase-js";
import {
  captureAuthCallback, releaseAuthAttempt,
  type AuthAttemptStart, type AuthCallbackCaptureOptions, type AuthFragmentStorage, type CapturedAuthCallback,
} from "@/lib/authRedirect";
import { isAuthUserBannedUntil } from "@/lib/authAccountBan";
import { withAuthFetchTimeout } from "@/lib/authFetch";
import { requestMagicLink, type PasswordlessAuthClient, type MagicLinkResult } from "@/lib/passwordlessAuth";
import { discardBody } from "@/lib/responseBody";
import { resolveSupabaseConfig, type SupabaseConfig } from "@/lib/supabaseConfig";
import { nativeAuthLandingUrl, nativeSessionCanInstall } from "@/lib/nativeIOSOAuth";
import { readNativeEmailCallback } from "@/lib/nativeEmailLinks";
import {
  createEmailPkce, IOS_EMAIL_AUTH_MODE, NATIVE_EMAIL_RECEIPT_TTL_MS,
  normalizeNativeEmail, readNativeEmailReceipt, removeNativeEmailReceipt, storeNativeEmailReceipt,
  type NativeEmailReceipt,
} from "@/lib/nativeEmailPkce";

export function nativeEmailAuthConfig(): SupabaseConfig | null {
  return resolveSupabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    expectedKeyRole: "publishable", allowUnknownKeyRole: process.env.NODE_ENV !== "production",
    requireHttps: process.env.NODE_ENV === "production",
  });
}
// Only "storage" means the browser refused the receipt. A superseded start is
// "obsolete", and crypto or malformed input is "failed".
export type NativeEmailReceiptPreparation =
  | { status: "prepared"; receipt: NativeEmailReceipt; challenge: string }
  | { status: "obsolete" | "storage" | "failed" };
export async function prepareNativeEmailReceipt(
  attempt: Extract<AuthAttemptStart, { ok: true }>, email: string | null,
  storage: AuthFragmentStorage | null, now = Date.now(), current: () => boolean = () => true,
  config: SupabaseConfig | null = nativeEmailAuthConfig(),
): Promise<NativeEmailReceiptPreparation> {
  try {
    if (!config) return { status: "failed" };
    const pkce = await createEmailPkce();
    if (!current()) return { status: "obsolete" };
    const callback = new URL(attempt.callbackUrl);
    callback.searchParams.set("native", IOS_EMAIL_AUTH_MODE);
    const receipt: NativeEmailReceipt = {
      version: 1, id: attempt.id, verifier: pkce.verifier, callbackUrl: callback.toString(),
      expectedEmail: email === null ? null : normalizeNativeEmail(email), authOrigin: new URL(config.url).origin,
      createdAt: now, expiresAt: now + NATIVE_EMAIL_RECEIPT_TTL_MS,
    };
    if (!storeNativeEmailReceipt(storage, receipt) || !readNativeEmailReceipt(storage, callback.origin, now)) {
      removeNativeEmailReceipt(storage, receipt.id);
      return { status: "storage" };
    }
    return { status: "prepared", receipt, challenge: pkce.challenge };
  } catch { return { status: "failed" }; }
}
export function discardNativeEmailAttempt(storage: AuthFragmentStorage | null, tabStorage: AuthFragmentStorage | null, origin: string): void {
  const receipt = readNativeEmailReceipt(storage, origin);
  if (receipt) releaseAuthAttempt(receipt.id, storage, tabStorage);
  removeNativeEmailReceipt(storage);
}
export async function requestNativeEmailLink(
  email: string, receipt: NativeEmailReceipt, challenge: string,
  config: SupabaseConfig, fetchImpl: typeof fetch = fetch,
): Promise<MagicLinkResult> {
  const auth: PasswordlessAuthClient = {
    signInWithOtp: async ({ email: address, options }) => {
      try {
        const target = new URL("/auth/v1/otp", config.url);
        target.searchParams.set("redirect_to", options.emailRedirectTo);
        const response = await withAuthFetchTimeout(fetchImpl)(target, {
          method: "POST", headers: { apikey: config.key, "content-type": "application/json", "x-supabase-api-version": "2024-01-01" },
          body: JSON.stringify({ email: address, create_user: options.shouldCreateUser, code_challenge: challenge, code_challenge_method: "s256" }),
          cache: "no-store", credentials: "omit", redirect: "error",
        });
        if (response.ok) { discardBody(response); return { error: null }; }
        const detail = await response.json().catch(() => ({})) as { error_code?: string; code?: string; msg?: string; message?: string };
        return { error: { status: response.status, code: detail.error_code ?? detail.code, message: detail.msg ?? detail.message } };
      } catch { return { error: { status: 500 } }; }
    },
  };
  return requestMagicLink(auth, email, receipt.callbackUrl);
}
function verifiedEmailUserMatches(user: Session["user"] & { banned_until?: string | null }, id: string, expectedEmail: string | null): boolean {
  return typeof user.id === "string" && user.id === id && typeof user.email_confirmed_at === "string" && user.email_confirmed_at.trim().length > 0 && !isAuthUserBannedUntil(user) &&
    (expectedEmail === null || (typeof user.email === "string" && normalizeNativeEmail(user.email) === expectedEmail));
}
export type NativeEmailCompletion =
  | { status: "established"; session: Session; captured: CapturedAuthCallback }
  | { status: "ignored" | "failed" };
export async function completeNativeEmailLink(raw: string, deps: {
  storage: AuthFragmentStorage | null; origin: string; ownership: AuthCallbackCaptureOptions;
  config: SupabaseConfig; current: () => boolean; fetchImpl?: typeof fetch;
  install: (session: Session) => Promise<{ data: { session: Session | null }; error: unknown } | null>;
}): Promise<NativeEmailCompletion> {
  const callback = readNativeEmailCallback(raw, deps.origin);
  const receipt = readNativeEmailReceipt(deps.storage, deps.origin);
  if (!callback || !receipt || receipt.id !== callback.id || !deps.current()) return { status: "ignored" };
  if (receipt.authOrigin !== new URL(deps.config.url).origin) {
    removeNativeEmailReceipt(deps.storage, receipt.id);
    releaseAuthAttempt(receipt.id, deps.storage, deps.ownership.tabStorage);
    return { status: "failed" };
  }
  let captured: CapturedAuthCallback | null = null;
  try {
    captured = await captureAuthCallback(nativeAuthLandingUrl(receipt.callbackUrl), deps.ownership);
    if (!captured?.localAttemptOwned || !deps.current()) return { status: "ignored" };
    // The existing Web Lock covers this receipt removal and the one-use exchange.
    if (!removeNativeEmailReceipt(deps.storage, receipt.id)) return { status: "failed" };
    if (!callback.code) return { status: "failed" };
    const request = withAuthFetchTimeout(deps.fetchImpl ?? fetch);
    const headers = { apikey: deps.config.key, "content-type": "application/json", "x-supabase-api-version": "2024-01-01" };
    const response = await request(new URL("/auth/v1/token?grant_type=pkce", deps.config.url), {
      method: "POST", headers, body: JSON.stringify({ auth_code: callback.code, code_verifier: receipt.verifier }),
      cache: "no-store", credentials: "omit", redirect: "error",
    });
    if (!response.ok || !deps.current()) { discardBody(response); return { status: "failed" }; }
    const session = await response.json() as Session;
    if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string" ||
        typeof session.user?.id !== "string" || !session.user.id || !nativeSessionCanInstall(session)) return { status: "failed" };
    const verified = await request(new URL("/auth/v1/user", deps.config.url), {
      headers: { ...headers, authorization: `Bearer ${session.access_token}` },
      cache: "no-store", credentials: "omit", redirect: "error",
    });
    if (!verified.ok || !deps.current()) { discardBody(verified); return { status: "failed" }; }
    const user = await verified.json() as Session["user"] & { banned_until?: string | null };
    if (!verifiedEmailUserMatches(user, session.user.id, receipt.expectedEmail)) return { status: "failed" };
    const installed = await deps.install({ ...session, user });
    if (!installed || installed.error || installed.data.session?.user.id !== user.id) return { status: "failed" };
    return { status: "established", session: installed.data.session, captured };
  } catch { return { status: "failed" }; }
  finally {
    if (captured?.localAttemptOwned) {
      removeNativeEmailReceipt(deps.storage, receipt.id);
      releaseAuthAttempt(receipt.id, deps.storage, deps.ownership.tabStorage);
    }
    captured?.releaseCoordination();
  }
}
