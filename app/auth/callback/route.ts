// Auth callback landing. Supabase Auth (Google / Azure / email magic link)
// redirects here
// with a `?code=` after the user approves. We hand that code back to the browser
// so the browser Supabase client — which holds the PKCE code-verifier in its own
// localStorage — explicitly completes `exchangeCodeForSession` on load (see
// lib/authClient.ts and components/auth/AuthProvider.tsx).
//
// Why forward instead of exchanging on the server: this app depends only on
// @supabase/supabase-js (no @supabase/ssr cookie adapter), so the verifier never
// reaches the server. The browser is the one place that can finish PKCE. We
// therefore redirect to the target path WITH the `?code=` preserved; the client
// exchanges it and then strips it from the URL. If @supabase/ssr is adopted
// later, a cookie-based `exchangeCodeForSession(code)` can move here unchanged.
//
// Errors (no code, or the IdP returned ?error=) return to the safe target with
// an authError flag so the app can explain the failure without blocking browsing.

import { NextResponse } from "next/server";
import {
  AUTH_ATTEMPT_PARAM,
  AUTH_CALLBACK_MARKER,
  REFERRAL_SIGNUP_PROOF_PARAM,
  isAuthAttemptId,
  safeAuthNext,
} from "@/lib/authRedirect";
import { verifyReferralSignupProof } from "@/lib/referralSignupProof.server";

/**
 * Only same-origin absolute paths are honoured.
 *
 * Rejects:
 *   - protocol-relative `//evil.com`
 *   - backslash scheme tricks (`/\evil.com` → `https://evil.com/` in WHATWG URL)
 *   - encoded variants after URLSearchParams decoding (`/%5cevil.com`)
 *   - embedded credentials / host overrides
 *
 * WHATWG `new URL("/\\evil.com", origin)` treats `\` as `/`, so a bare
 * startsWith("/") check is NOT sufficient — resolve against the request origin
 * and require the result to stay on that origin.
 */
export function safeNext(raw: string | null, origin: string): string {
  return safeAuthNext(raw, origin);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const next = safeNext(url.searchParams.get("next"), url.origin);
  const rawAttemptId = url.searchParams.get(AUTH_ATTEMPT_PARAM);
  const attemptId = isAuthAttemptId(rawAttemptId) ? rawAttemptId : null;
  const rawSignupProof = url.searchParams.get(REFERRAL_SIGNUP_PROOF_PARAM);
  const signupProof = attemptId
    ? verifyReferralSignupProof(rawSignupProof, attemptId)
    : null;

  // Google/Supabase reported a failure, or no code came back → land on the app
  // with a flag the UI renders, rather than a dead callback page. Preserve the
  // safe return path so a cancelled/expired attempt does not lose user context.
  if (oauthError || !code || !attemptId) {
    const dest = new URL(next, url.origin);
    dest.searchParams.set(AUTH_CALLBACK_MARKER, "1");
    if (attemptId) dest.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
    dest.searchParams.set("authError", "1");
    return NextResponse.redirect(dest);
  }

  // Forward the code to the target path; AuthProvider completes the PKCE
  // exchange explicitly, then removes the one-time parameters from the URL.
  const dest = new URL(next, url.origin);
  dest.searchParams.set("code", code);
  dest.searchParams.set(AUTH_CALLBACK_MARKER, "1");
  dest.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
  if (signupProof && rawSignupProof) {
    dest.searchParams.set(REFERRAL_SIGNUP_PROOF_PARAM, rawSignupProof);
  }
  return NextResponse.redirect(dest);
}
