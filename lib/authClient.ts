// Browser-only Supabase client (singleton) for OAuth and passwordless email sign-in.
//
// This is DISTINCT from lib/supabase.ts: that module is the server-only ADMIN
// client (service-role key, no session persistence, all writes route through it).
// This one runs in the browser, is built from the public anon/publishable key,
// and its only job is to establish an authenticated session (identity) via
// Supabase Auth. It never touches privileged tables.
//
// Flow: implicit. Supabase returns the session tokens in the callback URL
// fragment, so ANY browser can complete sign-in — not only the one that
// requested the link. PKCE was abandoned deliberately: its code-verifier lives
// in the requesting browser's localStorage, so an email magic link opened in a
// different browser (Gmail app → Safari) could never finish the exchange.
// AuthProvider explicitly establishes the session from the marked callback —
// see components/auth/AuthProvider.tsx and app/auth/callback/route.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { withAuthFetchTimeout } from "@/lib/authFetch";
import { resolveSupabaseConfig } from "@/lib/supabaseConfig";

// @supabase/supabase-js (~208KB) is DYNAMICALLY imported so it code-splits off
// the browser critical path instead of loading on every route via this module.
// Both the module import and the client construction are memoized so concurrent
// callers never double-import or build two clients. `cached` mirrors the resolved
// client synchronously for the best-effort sync accessor below.
let modulePromise: Promise<typeof import("@supabase/supabase-js")> | undefined;
let clientPromise: Promise<SupabaseClient | null> | undefined;
let cached: SupabaseClient | null | undefined;

/**
 * Start DOWNLOADING the auth chunk, without building a client.
 *
 * The chunk is code-split off the critical path on purpose, and it should stay
 * that way. The cost is not its size but WHEN the browser learns about it: a
 * dynamic import inside a React effect cannot be discovered until the tree has
 * hydrated, and on a throttled phone that is most of a second after every other
 * chunk has already arrived. Measured on /pal, the one route whose readiness
 * really waits for the session to answer: every other chunk started at about
 * 112 ms and this one at 1183 ms, so the route sat on its loading line waiting
 * for a download that had not been asked for yet.
 *
 * So the chunk is asked for at module-execution time instead, which is before
 * hydration rather than after it. Two things this deliberately does NOT do:
 *
 * It does not build the client. `createClient` starts session persistence and
 * background refresh, and moving those earlier would be a behaviour change
 * rather than a download. Only the module is fetched; `ensureSupabaseBrowser`
 * still constructs on first real call and still memoizes.
 *
 * It does not fetch anything a deployment cannot use. The config is resolved
 * first, exactly as `buildBrowserClient` does, so a keyless build downloads
 * nothing at all.
 */
export function warmAuthClientModule(): void {
  if (typeof window === "undefined") return;
  if (modulePromise) return;
  const config = resolveSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      expectedKeyRole: "publishable",
      allowUnknownKeyRole: process.env.NODE_ENV !== "production",
    },
  );
  if (!config) return;
  // A failed warm is not an answer about the viewer and must never look like
  // one: it is dropped here, and ensureSupabaseBrowser retries the import on
  // its own terms (lib/authClientLoad.ts owns that retry and its tri-state).
  modulePromise = import("@supabase/supabase-js");
  void modulePromise.catch(() => {
    modulePromise = undefined;
  });
}

function buildBrowserClient(): Promise<SupabaseClient | null> {
  return (async () => {
    const config = resolveSupabaseConfig(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        expectedKeyRole: "publishable",
        allowUnknownKeyRole: process.env.NODE_ENV !== "production",
      },
    );
    if (!config) return null;

    const { createClient } = await (modulePromise ??= import("@supabase/supabase-js"));
    cached = createClient(config.url, config.key, {
      global: {
        fetch: withAuthFetchTimeout(globalThis.fetch.bind(globalThis)),
      },
      auth: {
        // Keep the session in this browser and refresh it in the background.
        persistSession: true,
        autoRefreshToken: true,
        // AuthProvider establishes the session from the callback fragment
        // explicitly so failures can be surfaced and one-time tokens are
        // always scrubbed from the URL before any await. Automatic detection
        // would race this lazily-loaded client against that scrub.
        detectSessionInUrl: false,
        flowType: "implicit",
      },
    });
    return cached;
  })();
}

/**
 * The browser Supabase client, loading the supabase-js chunk on first call and
 * memoizing it. Resolves to null when the public env is absent (UI degrades to
 * "sign-in unavailable") or during SSR (no window/localStorage to persist into).
 * Auth-correctness-critical callers (AuthProvider, getAccessToken) await this.
 */
export function ensureSupabaseBrowser(): Promise<SupabaseClient | null> {
  // No window → server render. Never import the chunk on the server.
  if (typeof window === "undefined") return Promise.resolve(null);
  if (clientPromise) return clientPromise;

  const pending = buildBrowserClient();
  clientPromise = pending.then(
    (client) => {
      if (client === null) clientPromise = undefined;
      return client;
    },
    (error: unknown) => {
      clientPromise = undefined;
      modulePromise = undefined;
      throw error;
    },
  );
  return clientPromise;
}

/**
 * Best-effort SYNChronous accessor for consumers that return synchronously (the
 * realtime subscribe helpers). Returns the client once it has loaded, else null
 * while kicking off the lazy load in the background. A null here simply means the
 * caller degrades to its existing poll fallback until the client warms.
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (cached !== undefined) return cached;
  void ensureSupabaseBrowser();
  return null;
}

/** True when the public Supabase env is present (browser sign-in can be shown). */
export function isAuthConfigured(): boolean {
  return resolveSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      expectedKeyRole: "publishable",
      allowUnknownKeyRole: process.env.NODE_ENV !== "production",
    },
  ) !== null;
}

/**
 * The current session's access token (JWT), or null when signed out /
 * unconfigured. Ownership-sensitive writes send this as `Authorization: Bearer`
 * so the server can verify the caller's identity (lib/authServer.ts). Best-effort
 * and non-throwing: any failure resolves to null, and the caller simply makes an
 * anonymous request (still valid for an unlinked, demo handle).
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await ensureSupabaseBrowser();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
