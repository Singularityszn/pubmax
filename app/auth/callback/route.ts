// Auth callback landing. Web and Android sign-in, plus signed-in iPhone Add
// account, redirect here carrying the canonical implicit-flow session
// tokens in the URL FRAGMENT. The fragment never reaches this server; the
// browser carries it across our redirect below, and AuthProvider establishes
// the session from it on the landing page (see lib/authClient.ts and
// components/auth/AuthProvider.tsx).
//
// Separate signed-out iPhone returns use the fixed PKCE relays documented in
// docs/rules/ios-native-auth-return.md and docs/rules/ios-native-email-return.md.
//
// Why implicit rather than PKCE: the PKCE code-verifier lives in the
// REQUESTING browser's localStorage, so an email magic link opened in a
// different browser (Gmail app opening Safari) could never complete the
// exchange — Supabase verified the link, then the sign-in died client-side.
// Cross-browser email links matter more than keeping tokens out of the URL
// fragment, so that trade-off was reversed deliberately. This app depends only
// on @supabase/supabase-js (no @supabase/ssr cookie adapter), so a server-side
// exchange is not available either.
//
// For implicit callbacks, the tokens are invisible here. The route cannot
// determine success or failure. It forwards every valid attempt to the safe target with the
// callback marker; the client decides. Only a query-visible provider error or
// a missing attempt id earns the authError flag, so the app can explain the
// failure without blocking browsing.

import { NextResponse } from "next/server";
import { IOS_EMAIL_AUTH_MODE } from "@/lib/nativeEmailPkce";
import { IOS_AUTH_MODE, nativeAuthCallbackLocation } from "@/lib/nativeAuthCallback";
import {
  AUTH_ATTEMPT_PARAM,
  AUTH_CALLBACK_MARKER,
  REFERRAL_SIGNUP_PROOF_PARAM,
  isAuthAttemptId,
  safeAuthNext,
} from "@/lib/authRedirect";
import { verifyReferralSignupProof } from "@/lib/referralSignupProof.server";

/**
 * The Location we are about to send. Re-parse it and keep it only when its
 * origin is this request. A normalised `//` path parses as another origin;
 * that answer is `/` on this origin instead.
 */
function locationOnRequestOrigin(dest: URL, requestOrigin: string): URL {
  const allowed = new URL(requestOrigin).origin;
  const fallback = new URL("/", allowed);
  try {
    if (dest.origin !== allowed || dest.pathname.startsWith("//")) return fallback;
    const again = new URL(`${dest.pathname}${dest.search}`, allowed);
    if (again.origin !== allowed) return fallback;
    return dest;
  } catch {
    return fallback;
  }
}

// A browser that names itself and is not an iPhone, iPad or iPod cannot be the
// app that holds the email verifier. iPadOS Safari can report a desktop
// browser, so the page still offers the app link.
function opensOnAnotherDevice(request: Request): boolean {
  const agent = request.headers.get("user-agent");
  return agent !== null && agent.trim() !== "" && !/\b(?:iPhone|iPad|iPod)\b/.test(agent);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Plain HTML with no script or style, so the page needs nothing from the CSP.
function anotherDevicePage(appLocation: string, headers: Record<string, string>): Response {
  return new Response(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Open this link on your iPhone</title>
</head><body>
<main>
<h1>Open this link on your iPhone</h1>
<p>You asked for this sign-in link in the PUBMAXXING iPhone app. It works only on that iPhone.</p>
<p>Open the email on that iPhone and tap the link there.</p>
<p><a href="${escapeHtml(appLocation)}">Open in the PUBMAXXING app</a></p>
<p><a href="/login">Sign in on this device instead</a></p>
</main>
</body></html>`, {
    status: 200,
    headers: { ...headers, "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nativeMode = url.searchParams.getAll("native").length === 1 ? url.searchParams.get("native") : null;
  if (nativeMode === IOS_AUTH_MODE || nativeMode === IOS_EMAIL_AUTH_MODE) {
    const location = nativeAuthCallbackLocation(url);
    const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
    // The provider return never leaves the iPhone sheet; an email link can.
    if (nativeMode === IOS_EMAIL_AUTH_MODE && opensOnAnotherDevice(request)) return anotherDevicePage(location, headers);
    return new Response(null, { status: 307, headers: { location, ...headers } });
  }
  const oauthError = url.searchParams.get("error");
  const next = safeAuthNext(url.searchParams.get("next"), url.origin);
  const rawAttemptId = url.searchParams.get(AUTH_ATTEMPT_PARAM);
  const attemptId = isAuthAttemptId(rawAttemptId) ? rawAttemptId : null;
  const rawSignupProof = url.searchParams.get(REFERRAL_SIGNUP_PROOF_PARAM);
  const signupProof = attemptId
    ? verifyReferralSignupProof(rawSignupProof, attemptId)
    : null;

  // Google/Supabase reported a query-visible failure, or the attempt id is
  // missing → land on the app with a flag the UI renders, rather than a dead
  // callback page. Preserve the safe return path so a cancelled/expired
  // attempt does not lose user context.
  if (oauthError || !attemptId) {
    const dest = new URL(next, url.origin);
    dest.searchParams.set(AUTH_CALLBACK_MARKER, "1");
    if (attemptId) dest.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
    dest.searchParams.set("authError", "1");
    return NextResponse.redirect(locationOnRequestOrigin(dest, url.origin));
  }

  // Forward to the target path with the callback marker. The browser carries
  // the token (or error) fragment across this redirect. AuthProvider captures
  // and scrubs it before callback handling; this route cannot verify or
  // install credentials it never receives.
  const dest = new URL(next, url.origin);
  dest.searchParams.set(AUTH_CALLBACK_MARKER, "1");
  dest.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
  if (signupProof && rawSignupProof) {
    dest.searchParams.set(REFERRAL_SIGNUP_PROOF_PARAM, rawSignupProof);
  }
  // A fragment on Location would replace the token fragment the browser is
  // carrying. Legitimate callbacks never send one (buildAuthCallbackUrl strips
  // it); drop a crafted one rather than lose the session.
  dest.hash = "";
  return NextResponse.redirect(locationOnRequestOrigin(dest, url.origin));
}
