"use client";

// App-wide auth context. Holds the current Supabase session/user (or null) and
// exposes Google, Apple, passwordless email, and sign-out actions. Additive only:
// anonymous browsing is unaffected - nothing here gates a route or blocks a
// render. A signed-in session establishes identity for account-owned actions.
//
// React 19 note: `react-hooks/set-state-in-effect` is an ERROR here, so we never
// call setState synchronously in the effect body. The effect only SUBSCRIBES
// (getSession + onAuthStateChange); every setState fires from an async callback
// or an event handler, and the subscription is torn down on cleanup.
//
// Account onboarding owns handle selection after sign-in. Provider email and
// browser-local handles are never promoted to account identity automatically.

import { useAuth as useClerkAuth, useClerk } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import "@/app/auth/auth.css";
import AccountOnboarding from "@/components/identity/AccountOnboarding";
import IdentityNudge from "@/components/identity/IdentityNudge";
import {
  accountComposerAuth,
  captureAccountAuth,
  rejectAccountAuth,
  sameAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import { exchangeAuthCallbackCode } from "@/lib/authCallbackClient";
import { ensureSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import {
  guardSocialAuthProvider,
  loadClerkSocialAuthProviders,
  loadSocialAuthProviders,
  NO_SOCIAL_AUTH_PROVIDERS,
  type SocialAuthProviderAvailability,
} from "@/lib/authProviderAvailability";
import { isClerkConfigured } from "@/lib/clerkIdentity";
import { createAuthSessionTransitionTracker } from "@/lib/authSessionTransition";
import {
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT,
  beginCanonicalAuthAttempt,
  cancelAuthAttempt,
  releaseAuthAttempt,
  scrubAuthCallback,
  type CanonicalAuthAttemptStart,
  type CapturedAuthCallback,
} from "@/lib/authRedirect";
import { authedFetch } from "@/lib/authedFetch";
import { normalizeHandle } from "@/lib/profiles";
import {
  claimSignupReferralFromAuthCallback,
  withReferralSignupProof,
} from "@/lib/referralClaimClient";
import {
  IDENTITY_HANDLE_CHANGED_EVENT,
  identityHandleForOwner,
  resolveCanonicalIdentity,
  type IdentityHandleChangedDetail,
} from "@/lib/identityClient";
import { requestMagicLink, type MagicLinkResult } from "@/lib/passwordlessAuth";

const AUTH_CALLBACK_ERROR_MESSAGE =
  "Sign-in could not be completed. The link may be invalid or expired. Try again.";

function browserLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function browserLockManager(): LockManager | null {
  try {
    return typeof navigator !== "undefined" ? navigator.locks : null;
  } catch {
    return null;
  }
}

function releaseBrowserAuthAttempt(attemptId: string): void {
  releaseAuthAttempt(attemptId, browserLocalStorage(), browserSessionStorage());
}

function cancelBrowserAuthAttempt(): void {
  cancelAuthAttempt(browserLocalStorage(), browserSessionStorage());
}

async function prepareAuthCallback(
  currentUrl: string,
  requestedNext?: string,
): Promise<CanonicalAuthAttemptStart> {
  const attempt = await beginCanonicalAuthAttempt(
    currentUrl,
    requestedNext,
    {
      persistentStorage: browserLocalStorage(),
      tabStorage: browserSessionStorage(),
      cryptoProvider: globalThis.crypto,
      lockManager: browserLockManager(),
    },
    (url) => window.location.assign(url),
  );
  if (!attempt.ok) return attempt;
  return withReferralSignupProof(attempt, currentUrl, fetch);
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
  /** Social providers enabled by the current Supabase Auth settings read. */
  socialProviders: SocialAuthProviderAvailability;
  /** Start the Google OAuth redirect. No-op (returns an error) when unconfigured. */
  signInWithGoogle: () => Promise<{ error: string | null }>;
  /** Start the Apple OAuth redirect. No-op when unconfigured. */
  signInWithApple: () => Promise<{ error: string | null }>;
  /** Send a passwordless email link with normalized, non-enumerating feedback. */
  signInWithEmail: (email: string, next?: string) => Promise<MagicLinkResult>;
  /** User cancelled an abandoned provider or magic-link attempt. */
  cancelAuthAttempt: () => void;
  /** Clear the local session. */
  signOut: () => Promise<void>;
  /** Account-owned public handle, or null before onboarding or when signed out. */
  handle: string | null;
  rejectedContributionAuth: AccountAuthSnapshot | null;
  contributionAuth: AccountAuthSnapshot | null;
  invalidateContributionAuth: (auth: AccountAuthSnapshot) => void;
  getCurrentUserId: () => string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  // Session restore only applies when Supabase public env is present. When it
  // is not, there is nothing to wait for — derive `loading` false during render
  // instead of setState-in-effect (which cascaded a second render on every
  // mount and made the Sign in control flicker).
  const [sessionLoading, setSessionLoading] = useState(true);
  const [canonicalIdentity, setCanonicalIdentity] =
    useState<IdentityHandleChangedDetail | null>(null);
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null);
  const [socialProviders, setSocialProviders] =
    useState<SocialAuthProviderAvailability>(NO_SOCIAL_AUTH_PROVIDERS);
  const [rejectedContributionAuth, setRejectedContributionAuth] =
    useState<AccountAuthSnapshot | null>(null);
  const rejectedContributionAuthRef =
    useRef<AccountAuthSnapshot | null>(null);
  const configured = isAuthConfigured();
  const clerkConfigured = isClerkConfigured() && Boolean(session?.user);
  const clerk = useClerk();
  const { isLoaded: clerkLoaded } = useClerkAuth();
  const loading = configured && sessionLoading;
  const loadConfiguredSocialProviders = useCallback(async () => {
    if (!clerkConfigured) return loadSocialAuthProviders();
    const clerkApi = clerk as unknown as {
      environment?: unknown;
    };
    const browserClerk =
      typeof window === "undefined"
        ? undefined
        : (window as Window & { Clerk?: { environment?: unknown } }).Clerk;
    return loadClerkSocialAuthProviders(
      globalThis.fetch,
      browserClerk?.environment ?? clerkApi.environment,
    );
  }, [clerk, clerkConfigured]);
  const sessionTransitions = useRef(createAuthSessionTransitionTracker());
  const updateSession = useCallback(
    (nextSession: Session | null, event: string | null = null) => {
      const signedIn = sessionTransitions.current.update(
        event,
        nextSession?.user.id ?? null,
      );
      const nextAuth = captureAccountAuth(
        nextSession?.user.id ?? null,
        nextSession,
      );
      if (
        nextAuth &&
        rejectedContributionAuthRef.current &&
        !sameAccountAuth(nextAuth, rejectedContributionAuthRef.current)
      ) {
        rejectedContributionAuthRef.current = null;
        setRejectedContributionAuth(null);
      }
      setSession(nextSession);
      return signedIn;
    },
    [],
  );
  const invalidateContributionAuth = useCallback(
    (auth: AccountAuthSnapshot) => {
      const rejected = rejectAccountAuth(
        rejectedContributionAuthRef.current,
        auth,
      );
      rejectedContributionAuthRef.current = rejected;
      setRejectedContributionAuth(rejected);
    },
    [],
  );
  const getCurrentUserId = useCallback(
    () => sessionTransitions.current.currentUserId(),
    [],
  );
  // React Strict Mode replays effects in development. Reuse one exchange so a
  // one-time PKCE code is never redeemed twice by the replayed mount effect.
  const callbackExchangeInFlight = useRef<
    Promise<{ session: Session | null; failed: boolean }> | null
  >(null);

  useEffect(() => {
    if (!configured && !clerkConfigured) return;
    if (clerkConfigured && !clerkLoaded) return;
    let active = true;
    void loadConfiguredSocialProviders().then((availability) => {
      if (active) {
        setSocialProviders(availability ?? NO_SOCIAL_AUTH_PROVIDERS);
      }
    });
    return () => {
      active = false;
    };
  }, [clerkConfigured, clerkLoaded, configured, loadConfiguredSocialProviders]);
  const capturedCallback = useRef<Promise<CapturedAuthCallback | null> | undefined>(undefined);

  useEffect(() => {
    const user = session?.user ?? null;
    let active = true;
    const onChanged = (event: Event) => {
      const handle = identityHandleForOwner(
        (event as CustomEvent<unknown>).detail,
        user?.id ?? null,
      );
      if (handle !== null && user) {
        setCanonicalIdentity({
          ownerId: user.id,
          handle: normalizeHandle(handle),
        });
      }
    };
    window.addEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
    async function loadCanonicalHandle() {
      if (!user) {
        if (active) setCanonicalIdentity(null);
        return;
      }
      const resolution = await resolveCanonicalIdentity(
        user.id,
        session,
        browserLocalStorage(),
      ).catch(() => null);
      if (!active || !resolution?.ok) return;
      setCanonicalIdentity(resolution.identity);
    }
    void loadCanonicalHandle();
    return () => {
      active = false;
      window.removeEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
    };
  }, [session]);

  useEffect(() => {
    // Capture callback inputs once across React Strict Mode's effect replay and
    // scrub the address bar synchronously, before any exchange/network await.
    if (capturedCallback.current === undefined) {
      capturedCallback.current = scrubAuthCallback(
        window.location.href,
        (cleanUrl) => window.history.replaceState(window.history.state, "", cleanUrl),
        {
          persistentStorage: browserLocalStorage(),
          tabStorage: browserSessionStorage(),
          lockManager: browserLockManager(),
          onFragmentRestored: () => {
            window.dispatchEvent(new Event(AUTH_RETURN_FRAGMENT_RESTORED_EVENT));
          },
        },
      );
    }
    const callbackCapture = capturedCallback.current ?? Promise.resolve(null);

    // No Supabase public env: `loading` is already derived false during render
    // (`configured && sessionLoading`). Still scrub a leftover callback URL so
    // a reader who landed with one is not stranded. setAuthCallbackError is
    // gated on still-mounted so unmount does not setState after teardown.
    if (!configured) {
      let active = true;
      void callbackCapture.then((captured) => {
        const callbackAttempt = captured?.attempt ?? null;
        if (callbackAttempt?.attemptId) {
          releaseBrowserAuthAttempt(callbackAttempt.attemptId);
        }
        captured?.releaseCoordination();
        if (!active) return;
        if (callbackAttempt) setAuthCallbackError(AUTH_CALLBACK_ERROR_MESSAGE);
      });
      return () => {
        active = false;
      };
    }

    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;
    // Session restoration is additive; it must never hold the anonymous app or
    // Pub Pal onboarding behind an infinite loading screen when the provider is
    // slow, blocked, or temporarily unavailable. This fail-soft boundary also
    // covers the lazy supabase-js chunk import; sessionLoading stays true until
    // the client resolves and a session (or its absence) is known, so the
    // signed-in header never flickers signed-out → signed-in. A later auth
    // event can still hydrate the session after this boundary. All setState
    // calls below run from async callbacks or event handlers — never the
    // effect body — so react-hooks/set-state-in-effect stays clean.
    const loadingTimeout = window.setTimeout(() => {
      if (active) setSessionLoading(false);
    }, 2500);

    // Lazy-load the browser client (dynamic import) off the critical path, then
    // subscribe and restore. Everything client-dependent runs after it resolves.
    void ensureSupabaseBrowser().then((supabase) => {
      if (!active) return;

      // Unconfigured / SSR-only: nothing to subscribe to.
      if (!supabase) {
        window.clearTimeout(loadingTimeout);
        setSessionLoading(false);
        void callbackCapture.then((captured) => {
          const callbackAttempt = captured?.attempt ?? null;
          if (callbackAttempt?.attemptId) {
            releaseBrowserAuthAttempt(callbackAttempt.attemptId);
          }
          captured?.releaseCoordination();
          if (!active) return;
          if (callbackAttempt) setAuthCallbackError(AUTH_CALLBACK_ERROR_MESSAGE);
        });
        return;
      }

      // Live updates: SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED. The callback is
      // the ONLY place these setStates run — never the effect body.
      const registration = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (!active) return;
        const signedIn = updateSession(nextSession ?? null, event);
        setSessionLoading(false);
        if (event === "SIGNED_IN" && nextSession?.user) {
          if (signedIn) trackEvent("user_signed_in");
        }
        if (event === "SIGNED_OUT") {
          trackEvent("user_signed_out");
        }
      });
      subscription = registration.data.subscription;
      // Unmounted while the chunk was loading: tear the subscription right back
      // down so the cleanup's null slot doesn't leak it.
      if (!active) {
        subscription.unsubscribe();
        return;
      }

      // Prime from a callback code or any persisted session. PKCE is explicit so
      // missing-verifier, expired-code, and network failures become visible and
      // one-time URL parameters are removed on both success and failure.
      void (async () => {
        await Promise.resolve();
        const captured = await callbackCapture;
        const callbackAttempt = captured?.attempt ?? null;
        let exchangedSession: Session | null = null;
        let exchangeFailed = Boolean(
          callbackAttempt &&
            (callbackAttempt.providerError || !callbackAttempt.code || !callbackAttempt.attemptId),
        );
        try {
          if (callbackAttempt?.code && !callbackAttempt.providerError) {
            if (!callbackExchangeInFlight.current) {
              callbackExchangeInFlight.current = exchangeAuthCallbackCode(
                supabase.auth,
                callbackAttempt.code,
              );
            }
            const exchange = await callbackExchangeInFlight.current;
            exchangedSession = exchange.session;
            exchangeFailed = exchange.failed;
          }
        } finally {
          if (callbackAttempt?.attemptId) {
            releaseBrowserAuthAttempt(callbackAttempt.attemptId);
          }
          captured?.releaseCoordination();
        }
        if (!active) return;
        if (exchangeFailed) setAuthCallbackError(AUTH_CALLBACK_ERROR_MESSAGE);

        if (exchangedSession) {
          window.clearTimeout(loadingTimeout);
          updateSession(exchangedSession);
          setSessionLoading(false);
          if (callbackAttempt) {
            void claimSignupReferralFromAuthCallback({
              currentUrl: window.location.href,
              callback: callbackAttempt,
              request: authedFetch,
              replaceUrl: (cleanUrl) => {
                window.history.replaceState(
                  window.history.state,
                  "",
                  cleanUrl,
                );
              },
            });
          }
          return;
        }

        try {
          const { data } = await supabase.auth.getSession();
          if (!active) return;
          window.clearTimeout(loadingTimeout);
          updateSession(data.session ?? null);
          setSessionLoading(false);
        } catch {
          if (!active) return;
          window.clearTimeout(loadingTimeout);
          setSessionLoading(false);
        }
      })();
    });

    return () => {
      active = false;
      window.clearTimeout(loadingTimeout);
      subscription?.unsubscribe();
    };
  }, [configured, updateSession]);

  const startSupabaseGoogleOAuth = useCallback(async (): Promise<{ error: string | null }> => {
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    const attempt = await prepareAuthCallback(window.location.href);
    if ("navigationStarted" in attempt) return { error: null };
    if (!attempt.ok) return { error: attempt.message };
    const supabase = await ensureSupabaseBrowser().catch(() => null);
    if (!supabase) {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in is not configured." };
    }
    // origin is only read inside this handler (post-mount, browser-only), so it
    // is SSR-safe. redirectTo must be an allowed URL in Supabase Auth settings.
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: attempt.callbackUrl },
      });
      if (error) releaseBrowserAuthAttempt(attempt.id);
      return { error: error ? error.message : null };
    } catch {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in could not be started. Try again." };
    }
  }, []);

  const startSupabaseAppleOAuth = useCallback(async (): Promise<{ error: string | null }> => {
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    const attempt = await prepareAuthCallback(window.location.href);
    if ("navigationStarted" in attempt) return { error: null };
    if (!attempt.ok) return { error: attempt.message };
    const supabase = await ensureSupabaseBrowser().catch(() => null);
    if (!supabase) {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in is not configured." };
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: attempt.callbackUrl,
        },
      });
      if (error) releaseBrowserAuthAttempt(attempt.id);
      return { error: error ? error.message : null };
    } catch {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in could not be started. Try again." };
    }
  }, []);

  /**
   * Clerk owns this click when configured. Its account is deliberately kept
   * separate from the Supabase session, which remains the PUBMAXX User ID.
   */
  const startClerkOAuth = useCallback(async (): Promise<{ error: string | null }> => {
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    try {
      clerk.openSignIn({
        oauthFlow: "redirect",
        fallbackRedirectUrl: window.location.href,
        forceRedirectUrl: window.location.href,
      });
      return { error: null };
    } catch {
      return { error: "Sign-in could not be started. Try again." };
    }
  }, [clerk]);

  const signInWithGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    const guarded = await guardSocialAuthProvider(
      "google",
      clerkConfigured ? startClerkOAuth : startSupabaseGoogleOAuth,
      loadConfiguredSocialProviders,
    );
    setSocialProviders(guarded.availability ?? NO_SOCIAL_AUTH_PROVIDERS);
    return guarded.result;
  }, [
    clerkConfigured,
    loadConfiguredSocialProviders,
    startClerkOAuth,
    startSupabaseGoogleOAuth,
  ]);

  const signInWithApple = useCallback(async (): Promise<{ error: string | null }> => {
    const guarded = await guardSocialAuthProvider(
      "apple",
      clerkConfigured ? startClerkOAuth : startSupabaseAppleOAuth,
      loadConfiguredSocialProviders,
    );
    setSocialProviders(guarded.availability ?? NO_SOCIAL_AUTH_PROVIDERS);
    return guarded.result;
  }, [clerkConfigured, loadConfiguredSocialProviders, startClerkOAuth, startSupabaseAppleOAuth]);

  const signInWithEmail = useCallback(
    async (email: string, next?: string): Promise<MagicLinkResult> => {
      if (typeof window === "undefined") {
        return { status: "error", message: "Sign-in is unavailable on this page." };
      }
      const attempt = await prepareAuthCallback(window.location.href, next);
      if ("navigationStarted" in attempt) {
        return {
          status: "error",
          message: "Continue sign-in on pubmaxxing.com.",
        };
      }
      if (!attempt.ok) return { status: "error", message: attempt.message };
      const supabase = await ensureSupabaseBrowser().catch(() => null);
      if (!supabase) {
        releaseBrowserAuthAttempt(attempt.id);
        return { status: "error", message: "Sign-in is not configured." };
      }
      const result = await requestMagicLink(supabase.auth, email, attempt.callbackUrl);
      if (result.status !== "sent") {
        releaseBrowserAuthAttempt(attempt.id);
      }
      return result;
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    const supabase = await ensureSupabaseBrowser();
    if (!supabase) return;
    await supabase.auth.signOut();
    // onAuthStateChange fires SIGNED_OUT → session clears via the subscription.
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const contributionAuth = accountComposerAuth(
      user?.id ?? null,
      session,
      rejectedContributionAuth,
    );
    return {
      session,
      user,
      loading,
      configured,
      socialProviders,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      cancelAuthAttempt: cancelBrowserAuthAttempt,
      signOut,
      handle: identityHandleForOwner(
        canonicalIdentity,
        user?.id ?? null,
      ),
      rejectedContributionAuth,
      contributionAuth,
      invalidateContributionAuth,
      getCurrentUserId,
    };
  }, [
    session,
    loading,
    configured,
    socialProviders,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    signOut,
    canonicalIdentity,
    rejectedContributionAuth,
    invalidateContributionAuth,
    getCurrentUserId,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {authCallbackError ? (
        <div className="authCallbackNotice" role="alert">
          <span>{authCallbackError}</span>
          <button type="button" onClick={() => setAuthCallbackError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {/* Signed-out account nudge after a high-intent action. Self-gates on
          auth + a pending trigger, so it renders nothing until armed. */}
      <AccountOnboarding />
      <IdentityNudge />
    </AuthContext.Provider>
  );
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
    socialProviders: NO_SOCIAL_AUTH_PROVIDERS,
    signInWithGoogle: async () => ({ error: "Sign-in is not configured." }),
    signInWithApple: async () => ({ error: "Sign-in is not configured." }),
    signInWithEmail: async () => ({ status: "error", message: "Sign-in is not configured." }),
    cancelAuthAttempt: () => {},
    signOut: async () => {},
    handle: null,
    rejectedContributionAuth: null,
    contributionAuth: null,
    invalidateContributionAuth: () => {},
    getCurrentUserId: () => null,
  };
}
