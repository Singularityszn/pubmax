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

import { getAccessToken, getSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import { normalizeHandle } from "@/lib/profiles";

const HANDLE_KEY = "pubmax_handle";

/** Wave I2: sync localStorage handle + claim/link profile on first signed-in session. */
async function syncIdentityAfterSignIn(user: User): Promise<void> {
  const handle = handleFromUser(user);
  if (!handle || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HANDLE_KEY, handle);
  } catch {
    // storage disabled — still attempt the server link below
  }
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch(`/api/profiles/${encodeURIComponent(handle)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      // Empty patch: gateHandleAction claimOnUnlinked links user_id on first write.
      body: JSON.stringify({}),
    });
  } catch {
    // Best-effort — messaging UI still prompts sign-in if link fails.
  }
}

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
   * Wave I2 also syncs this into `pubmax_handle` and PATCHes the profile so
   * `profiles.user_id` links on first signed-in session.
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
        // Wave I2: refresh identity sync for an already-persisted session.
        if (data.session?.user) void syncIdentityAfterSignIn(data.session.user);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    // Live updates: SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED. The callback is
    // the ONLY place these setStates run — never the effect body.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession ?? null);
      setLoading(false);
      // Wave I2: on sign-in, sync pubmax_handle + link profiles.user_id.
      if (event === "SIGNED_IN" && nextSession?.user) {
        void syncIdentityAfterSignIn(nextSession.user);
      }
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
