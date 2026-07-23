// Browser-only Supabase client (singleton) for OAuth and passwordless email sign-in.
//
// This is DISTINCT from lib/supabase.ts: that module is the server-only ADMIN
// client (service-role key, no session persistence, all writes route through it).
// This one runs in the browser, is built from the public anon/publishable key,
// and its only job is to establish an authenticated session (identity) via
// Supabase Auth. It never touches privileged tables.
//
// Flow: PKCE (the supabase-js default). The code-verifier is minted and stored
// in this browser's localStorage; AuthProvider explicitly finishes the exchange
// when it lands back on a URL carrying our marked `?code=` — see
// components/auth/AuthProvider.tsx and app/auth/callback/route.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { withAuthFetchTimeout } from "@/lib/authFetch";

let cached: SupabaseClient | null | undefined;

/**
 * The browser Supabase client, or null when the public env is absent (so the
 * UI degrades to "sign-in unavailable" instead of throwing at import time).
 * Guarded for SSR: on the server there is no window/localStorage, and calling
 * this returns null rather than constructing a client that can't persist.
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  // No window → server render. Return null; the provider loads the session
  // asynchronously once mounted in the browser.
  if (typeof window === "undefined") {
    cached = null;
    return cached;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  cached = url && key
    ? createClient(url, key, {
      global: {
        fetch: withAuthFetchTimeout(globalThis.fetch.bind(globalThis)),
      },
      auth: {
        // Keep the session in this browser and refresh it in the background.
        persistSession: true,
        autoRefreshToken: true,
        // AuthProvider completes PKCE explicitly so exchange failures can be
        // surfaced and one-time URL parameters are always removed.
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
    : null;

  return cached;
}

/** True when the public Supabase env is present (browser sign-in can be shown). */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * The current session's access token (JWT), or null when signed out /
 * unconfigured. Ownership-sensitive writes send this as `Authorization: Bearer`
 * so the server can verify the caller's identity (lib/authServer.ts). Best-effort
 * and non-throwing: any failure resolves to null, and the caller simply makes an
 * anonymous request (still valid for an unlinked, demo handle).
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
