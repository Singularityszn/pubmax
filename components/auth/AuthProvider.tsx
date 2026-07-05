"use client";

// App-wide auth context. Holds the current Supabase session/user (or null) and
// exposes signInWithGoogle()/signOut(). Additive only: anonymous browsing is
// unaffected — nothing here gates a route or blocks a render. A signed-in
// session just establishes identity for future authed actions.
//
// React 19 note: `react-hooks/set-state-in-effect` is an ERROR here, so we never
// call setState synchronously in the effect body. The effect only SUBSCRIBES
// (getSession + onAuthStateChange); every setState fires from an async callback
// or an event handler, and the subscription is torn down on cleanup.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { getSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import { normalizeHandle } from "@/lib/profiles";

export type AuthContextValue = {
  /** Current session, or null when signed out / not yet loaded. */
  session: Session | null;
  /** Convenience: session?.user, or null. */
  user: User | null;
  /** True until the first getSession() resolves — lets UI avoid a flash. */
  loading: boolean;
  /** True when the public Supabase env is present (sign-in can be attempted). */
  configured: boolean;
  /** Start the Google OAuth redirect. No-op (returns an error) when unconfigured. */
  signInWithGoogle: () => Promise<{ error: string | null }>;
  /** Clear the local session. */
  signOut: () => Promise<void>;
  /**
   * A normalized handle derived from the signed-in Google email local-part, or
   * null when signed out. Used by the Profile tab to link to /u/<handle>.
   * This is a best-effort CLIENT derivation only — it does NOT write
   * profiles.user_id (server-side profile linking is a follow-up).
   */
  handle: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Derive a stable handle from a signed-in user's Google email local-part. */
function handleFromUser(user: User | null): string | null {
  if (!user) return null;
  const email = typeof user.email === "string" ? user.email : "";
  const local = email.split("@")[0] ?? "";
  const normalized = normalizeHandle(local);
  return normalized || null;
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isAuthConfigured();

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    // Unconfigured / SSR-only: nothing to subscribe to. Flip loading off in a
    // microtask so we never setState synchronously in the effect body.
    if (!supabase) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }

    let active = true;

    // Prime from any persisted session (async → setState is safe here).
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    // Live updates: SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED. The callback is
    // the ONLY place these setStates run — never the effect body.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      return { error: "Sign-in is not configured." };
    }
    // origin is only read inside this handler (post-mount, browser-only), so it
    // is SSR-safe. redirectTo must be an allowed URL in Supabase Auth settings.
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    });
    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    await supabase.auth.signOut();
    // onAuthStateChange fires SIGNED_OUT → session clears via the subscription.
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    return {
      session,
      user,
      loading,
      configured,
      signInWithGoogle,
      signOut,
      handle: handleFromUser(user),
    };
  }, [session, loading, configured, signInWithGoogle, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Read the auth context. Returns a safe signed-out shape outside a provider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  // Defensive default so a stray consumer never throws — treated as signed out.
  return {
    session: null,
    user: null,
    loading: false,
    configured: false,
    signInWithGoogle: async () => ({ error: "Sign-in is not configured." }),
    signOut: async () => {},
    handle: null,
  };
}
