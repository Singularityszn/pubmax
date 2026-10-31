// Browser-only Supabase clients for OAuth and passwordless email sign-in.
//
// This is DISTINCT from lib/supabase.ts: that module is the server-only ADMIN
// client (service-role key, no session persistence, all writes route through it).
// This one runs in the browser, is built from the public anon/publishable key,
// and its only job is to establish an authenticated session (identity) via
// Supabase Auth. It never touches privileged tables.
//
// The canonical singleton uses implicit auth so an email link can complete
// in another browser. A verifier confined to the requesting browser would
// prevent that exchange. AuthProvider establishes the marked callback session.
// The separate iPhone PKCE client and guarded canonical installer follow
// docs/rules/ios-native-auth-return.md. The email transport is owned by
// docs/rules/ios-native-email-return.md.

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isAuthAttemptId } from "@/lib/authRedirect";
import { withAuthFetchTimeout } from "@/lib/authFetch";
import { providerOwnsSession, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { discardBody } from "@/lib/responseBody";
import { resolveSupabaseConfig } from "@/lib/supabaseConfig";

// @supabase/supabase-js (~208KB) is DYNAMICALLY imported so it code-splits off
// the browser critical path instead of loading on every route via this module.
// Both the module import and the client construction are memoized so concurrent
// callers never double-import or build two clients. `cached` mirrors the resolved
// client synchronously for the best-effort sync accessor below.
let modulePromise: Promise<typeof import("@supabase/supabase-js")> | undefined;
let clientPromise: Promise<SupabaseClient | null> | undefined;
let cached: SupabaseClient | null | undefined;

type NativeInstallation = { auth: SupabaseClient["auth"]; session: Session; current: () => boolean; settled: boolean };
let nativeInstallation: NativeInstallation | null = null;
let canonicalStorage: { storage: Storage; key: string } | null = null;

function sameNativeTokens(value: unknown, session: Session): boolean {
  const candidate = value as Partial<Session> | null;
  return candidate?.access_token === session.access_token && candidate.refresh_token === session.refresh_token;
}

function sameNativeSession(value: unknown, session: Session): boolean {
  return (value as Partial<Session> | null)?.user?.id === session.user.id && sameNativeTokens(value, session);
}

export function nativeSessionInstallationPending(session: Session | null): boolean {
  return !!session && !!nativeInstallation && sameNativeTokens(session, nativeInstallation.session);
}

export function discardCancelledNativeSessionInstallation(): void {
  const pending = nativeInstallation;
  if (!pending || pending.current() || pending.auth !== cached?.auth || !canonicalStorage) return;
  const { storage, key } = canonicalStorage;
  try {
    const raw = storage.getItem(key);
    if (raw && sameNativeSession(JSON.parse(raw), pending.session)) storage.removeItem(key);
  } catch {}
  if (pending.settled && nativeInstallation === pending) nativeInstallation = null;
}

export function finishNativeSessionInstallation(session: Session): boolean {
  const pending = nativeInstallation;
  if (!pending || !pending.settled || !pending.current() || !sameNativeSession(session, pending.session)) return false;
  nativeInstallation = null;
  return true;
}

export async function installNativeSession(
  auth: SupabaseClient["auth"], session: Session, current: () => boolean,
): Promise<Awaited<ReturnType<SupabaseClient["auth"]["setSession"]>> | null> {
  const active = await auth.getSession();
  if (active.error || active.data.session || nativeInstallation || !current() || (auth === cached?.auth && !canonicalStorage)) return null;
  const pending = { auth, session, current, settled: false };
  nativeInstallation = pending;
  let established = false;
  try {
    const installed = await auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    established = current() && !installed.error && sameNativeSession(installed.data.session, session);
    return current() ? installed : null;
  } catch { return null; }
  finally {
    pending.settled = true;
    try { discardCancelledNativeSessionInstallation(); }
    finally { if (!established && nativeInstallation === pending) nativeInstallation = null; }
  }
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
    const storageKey = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
    let storage: Storage | null = null;
    try {
      const candidate = window.localStorage;
      if (candidate) {
        const probe = `sb-localstorage-test-${Math.random()}`;
        candidate.setItem(probe, probe);
        candidate.removeItem(probe);
        storage = candidate;
      }
    } catch {}
    canonicalStorage = storage ? { storage, key: storageKey } : null;
    const browserStorage = storage;
    const request = globalThis.fetch.bind(globalThis);
    cached = createClient(config.url, config.key, {
      global: {
        fetch: withAuthFetchTimeout(async (input, init) => {
          const pending = nativeInstallation;
          const response = await request(input, init);
          if (pending?.auth === cached?.auth && pending && !response.ok &&
              new URL(String(input)).pathname === "/auth/v1/user") {
            for (const [name, value] of new Headers(init?.headers)) {
              if (name === "authorization" && value === `Bearer ${pending.session.access_token}`) {
                discardBody(response);
                throw new Error("Native session verification failed.");
              }
            }
          }
          return response;
        }),
      },
      auth: {
        ...(browserStorage ? { storage: {
          getItem: (key: string) => browserStorage.getItem(key),
          setItem: (key: string, value: string) => {
            const pending = nativeInstallation;
            if (key === storageKey && pending && pending.auth === cached?.auth && sameNativeTokens(JSON.parse(value), pending.session)) {
              if (!sameNativeSession(JSON.parse(value), pending.session) || !pending.current() || browserStorage.getItem(key) !== null) throw new Error("Native session installation lost ownership.");
            }
            browserStorage.setItem(key, value);
          },
          removeItem: (key: string) => browserStorage.removeItem(key),
        } } : {}),
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
 * The SDK's storage read can lag the provider's account event.
 * Release a Supabase token only when its owner matches that provider's account
 * and the account signal captured before the read remains active.
 * A sign-out and return to the same account also invalidates that read.
 * Unavailable browser auth, a failed session read or an ownership mismatch
 * returns null. Browser-client initialisation can reject.
 * The transport in lib/authedFetch.ts decides whether a missing token permits
 * an anonymous request or requires a retry or refusal.
 */
export async function getAccessToken(): Promise<string | null> {
  const accountSignal = readProviderAccountSignal();
  const supabase = await ensureSupabaseBrowser();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (accountSignal.aborted || !providerOwnsSession("supabase", session?.user?.id)) return null;
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function createNativeAuthClient(attemptId: string): Promise<SupabaseClient | null> {
  if (typeof window === "undefined" || !isAuthAttemptId(attemptId)) return null;
  const config = resolveSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { expectedKeyRole: "publishable", allowUnknownKeyRole: process.env.NODE_ENV !== "production" },
  );
  if (!config) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(config.url, config.key, {
    global: { fetch: withAuthFetchTimeout(globalThis.fetch.bind(globalThis)) },
    auth: {
      storageKey: `pubmax-native-auth-${attemptId}`,
      flowType: "pkce",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
