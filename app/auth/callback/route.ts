// OAuth callback landing. Google (via Supabase Auth) redirects here with a
// `?code=` after the user approves. We hand that code back to the browser so the
// browser Supabase client — which holds the PKCE code-verifier in its own
// localStorage — completes `exchangeCodeForSession` on load (see
// lib/authClient.ts `detectSessionInUrl` and components/auth/AuthProvider.tsx).
//
// Why forward instead of exchanging on the server: this app depends only on
// @supabase/supabase-js (no @supabase/ssr cookie adapter), so the verifier never
// reaches the server. The browser is the one place that can finish PKCE. We
// therefore redirect to the target path WITH the `?code=` preserved; the client
// exchanges it and then strips it from the URL. If @supabase/ssr is adopted
// later, a cookie-based `exchangeCodeForSession(code)` can move here unchanged.
//
// Errors (no code, or Google returned ?error=) degrade to /?authError=1 so the
// app always lands somewhere valid — anonymous browsing is never blocked.

import { NextResponse } from "next/server";

// Only same-origin, absolute-path `next` values are honoured, so the redirect
// can never be pointed at an external site (open-redirect guard).
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const next = safeNext(url.searchParams.get("next"));

  // Google/Supabase reported a failure, or no code came back → land on the app
  // with a flag the UI can read, rather than a dead callback page.
  if (oauthError || !code) {
    return NextResponse.redirect(new URL("/?authError=1", url.origin));
  }

  // Forward the code to the target path; the browser client completes the PKCE
  // exchange via detectSessionInUrl, then removes the code from the address bar.
  const dest = new URL(next, url.origin);
  dest.searchParams.set("code", code);
  return NextResponse.redirect(dest);
}
