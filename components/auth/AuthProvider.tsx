"use client";

// App-wide auth context. Holds the current Supabase session/user (or null) and
// exposes Google, Microsoft, passwordless email, and sign-out actions. Additive only:
// anonymous browsing is unaffected — nothing here gates a route or blocks a
// render. A signed-in session just establishes identity for future authed actions.
//
// React 19 note: `react-hooks/set-state-in-effect` is an ERROR here, so we never
// call setState synchronously in the effect body. The effect only SUBSCRIBES
// (getSession + onAuthStateChange); every setState fires from an async callback
// or an event handler, and the subscription is torn down on cleanup.
//
// Wave L3: first sign-in may open "Claim your night" when the device handle
// differs from the email-derived auth handle (or has activity / conflicts).
// Never silently overwrite localStorage pubmax_handle in that case.

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
import posthog from "posthog-js";

import "@/app/auth/auth.css";
import { ClaimNightDialog } from "@/components/auth/ClaimNightDialog";
import IdentityNudge from "@/components/identity/IdentityNudge";
import { trackEvent } from "@/lib/analytics";
import { exchangeAuthCallbackCode } from "@/lib/authCallbackClient";
import { ensureSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import {
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT,
  beginCoordinatedAuthAttempt,
  cancelAuthAttempt,
  releaseAuthAttempt,
  scrubAuthCallback,
  type AuthAttemptStart,
  type CapturedAuthCallback,
} from "@/lib/authRedirect";
import { authedFetch } from "@/lib/authedFetch";
import type { ClaimChoice, ClaimPreview } from "@/lib/identityClaim";
import { readDeviceHandle } from "@/lib/identityClaimClient";
import { normalizeHandle } from "@/lib/profiles";
import { emitIdentityHandleChanged, IDENTITY_HANDLE_CHANGED_EVENT } from "@/lib/identityClient";
import { requestMagicLink, type MagicLinkResult } from "@/lib/passwordlessAuth";

const HANDLE_KEY = "pubmax_handle";
const SYNCED_USER_KEY = "pubmax_identity_synced_user";
const CLAIM_DEFERRED_KEY = "pubmax_claim_deferred";
const AUTH_CALLBACK_ERROR_MESSAGE =
  "Sign-in could not be completed. The link may be invalid or expired. Try again.";

type ClaimPreviewResponse = ClaimPreview & { needsClaim: boolean };

function isClaimDeferred(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(CLAIM_DEFERRED_KEY) === userId;
  } catch {
    return false;
  }
}

function markClaimDeferred(userId: string): void {
  try {
    window.sessionStorage.setItem(CLAIM_DEFERRED_KEY, userId);
  } catch {
    // best-effort — skip spam prevention only
  }
}

function clearClaimDeferred(): void {
  try {
    window.sessionStorage.removeItem(CLAIM_DEFERRED_KEY);
  } catch {
    // ignore
  }
}

function markSynced(userId: string): void {
  try {
    window.sessionStorage.setItem(SYNCED_USER_KEY, userId);
  } catch {
    // best-effort dedupe marker
  }
}

function isAlreadySynced(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(SYNCED_USER_KEY) === userId;
  } catch {
    return false;
  }
}

function writeDeviceHandle(handle: string): void {
  try {
    window.localStorage.setItem(HANDLE_KEY, handle);
  } catch {
    // storage disabled — server link still proceeds
  }
  emitIdentityHandleChanged(handle);
}

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
): Promise<AuthAttemptStart> {
  return beginCoordinatedAuthAttempt(
    currentUrl,
    requestedNext,
    {
      persistentStorage: browserLocalStorage(),
      tabStorage: browserSessionStorage(),
      cryptoProvider: globalThis.crypto,
      lockManager: browserLockManager(),
    },
  );
}

/** Quick path: PATCH-link auth handle and stamp localStorage (no dialog). */
async function linkAuthHandleQuick(user: User, authHandle: string): Promise<boolean> {
  writeDeviceHandle(authHandle);
  try {
    const res = await authedFetch(`/api/profiles/${encodeURIComponent(authHandle)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return false;
    markSynced(user.id);
    return true;
  } catch {
    return false;
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
  /** Start the Microsoft (Azure) OAuth redirect. No-op when unconfigured. */
  signInWithMicrosoft: () => Promise<{ error: string | null }>;
  /** Send a passwordless email link with normalized, non-enumerating feedback. */
  signInWithEmail: (email: string, next?: string) => Promise<MagicLinkResult>;
  /** User cancelled an abandoned provider or magic-link attempt. */
  cancelAuthAttempt: () => void;
  /** Clear the local session. */
  signOut: () => Promise<void>;
  /**
   * A normalized handle derived from the signed-in email local-part, or null
   * when signed out. Used by the Profile tab to link to /u/<handle>.
   * Wave L3 may keep a different device handle until the user confirms claim.
   */
  handle: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Derive a stable handle from a signed-in user's email local-part. */
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
  const [claimPreview, setClaimPreview] = useState<ClaimPreview | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [canonicalHandle, setCanonicalHandle] = useState<string | null>(null);
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null);
  const configured = isAuthConfigured();
  // Guard overlapping sync runs (getSession + SIGNED_IN can both fire).
  const syncInFlight = useRef<string | null>(null);
  // React Strict Mode replays effects in development. Reuse one exchange so a
  // one-time PKCE code is never redeemed twice by the replayed mount effect.
  const callbackExchangeInFlight = useRef<
    Promise<{ session: Session | null; failed: boolean }> | null
  >(null);
  const capturedCallback = useRef<Promise<CapturedAuthCallback | null> | undefined>(undefined);

  useEffect(() => {
    const user = session?.user ?? null;
    let active = true;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ handle?: unknown }>).detail;
      if (typeof detail?.handle === "string") setCanonicalHandle(normalizeHandle(detail.handle));
    };
    window.addEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
    async function loadCanonicalHandle() {
      if (!user) {
        if (active) setCanonicalHandle(null);
        return;
      }
      const response = await authedFetch("/api/identity/handle/current").catch(() => null);
      if (!active || !response?.ok) return;
      const body = await response.json() as { handle?: string | null };
      setCanonicalHandle(body.handle ? normalizeHandle(body.handle) : handleFromUser(user));
    }
    void loadCanonicalHandle();
    return () => {
      active = false;
      window.removeEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
    };
  }, [session?.user]);

  const openClaim = useCallback((preview: ClaimPreview) => {
    setClaimError(null);
    setClaimBusy(false);
    setClaimPreview(preview);
  }, []);

  const closeClaim = useCallback(() => {
    setClaimPreview(null);
    setClaimError(null);
    setClaimBusy(false);
  }, []);

  const syncIdentityAfterSignIn = useCallback(
    async (user: User): Promise<void> => {
      const authHandle = handleFromUser(user);
      if (!authHandle || typeof window === "undefined") return;

      // Dedupe: cold loads + SIGNED_IN (incl. tab focus rehydration) must not
      // spam claim-preview / PATCH once this tab has already linked this user.
      if (isAlreadySynced(user.id)) return;
      if (isClaimDeferred(user.id)) return;
      if (syncInFlight.current === user.id) return;
      syncInFlight.current = user.id;

      try {
        const deviceHandle = readDeviceHandle();

        // No prior device identity → existing quick link path.
        if (!deviceHandle || deviceHandle === authHandle) {
          // Same (or empty) handle: still ask the server whether activity /
          // conflicts require the dialog — empty device skips preview.
          if (!deviceHandle) {
            await linkAuthHandleQuick(user, authHandle);
            return;
          }

          const qs = new URLSearchParams({
            deviceHandle,
          });
          const res = await authedFetch(`/api/identity/claim-preview?${qs.toString()}`);
          if (!res.ok) {
            // Preview failed — fall back to quick link only when handles match
            // (no overwrite risk of a different device handle).
            if (deviceHandle === authHandle) await linkAuthHandleQuick(user, authHandle);
            return;
          }
          const body = (await res.json()) as ClaimPreviewResponse;
          if (body.needsClaim) {
            openClaim(body);
            return;
          }
          await linkAuthHandleQuick(user, authHandle);
          return;
        }

        // Handles differ — always consult preview (dialog when needsClaim).
        const qs = new URLSearchParams({ deviceHandle });
        const res = await authedFetch(`/api/identity/claim-preview?${qs.toString()}`);
        if (!res.ok) {
          // Do NOT overwrite device handle on preview failure.
          return;
        }
        const body = (await res.json()) as ClaimPreviewResponse;
        if (body.needsClaim) {
          openClaim(body);
          return;
        }
        // Differing handles with needsClaim=false shouldn't happen (decideClaimNeed
        // always true when handles differ) — still refuse silent overwrite.
        openClaim(body);
      } catch {
        // Best-effort — messaging UI still prompts sign-in if link fails.
      } finally {
        if (syncInFlight.current === user.id) syncInFlight.current = null;
      }
    },
    [openClaim],
  );

  const onClaimConfirm = useCallback(
    async (choice: ClaimChoice) => {
      if (!claimPreview || !session?.user) return;
      setClaimBusy(true);
      setClaimError(null);
      try {
        trackEvent("claim_started", { source: "auth" });
        const res = await authedFetch("/api/identity/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            choice,
            deviceHandle: claimPreview.deviceHandle,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          handle?: string;
          error?: string;
        };
        if (!res.ok) {
          setClaimError(
            typeof body.error === "string" ? body.error : "Could not claim that handle.",
          );
          return;
        }
        const handle =
          typeof body.handle === "string" && body.handle
            ? normalizeHandle(body.handle)
            : choice === "device"
              ? claimPreview.deviceHandle
              : claimPreview.authHandle;
        if (handle) writeDeviceHandle(handle);
        trackEvent("claim_completed", { source: "auth" });
        markSynced(session.user.id);
        clearClaimDeferred();
        closeClaim();
      } catch {
        setClaimError("Could not claim that handle.");
      } finally {
        setClaimBusy(false);
      }
    },
    [claimPreview, closeClaim, session],
  );

  const onClaimSkip = useCallback(() => {
    if (session?.user) markClaimDeferred(session.user.id);
    // Do NOT overwrite device handle; do NOT mark synced.
    closeClaim();
  }, [closeClaim, session]);

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

    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;
    // Session restoration is additive; it must never hold the anonymous app or
    // Pub Pal onboarding behind an infinite loading screen when the provider is
    // slow, blocked, or temporarily unavailable. This fail-soft boundary also
    // covers the lazy supabase-js chunk import; loading stays true until the
    // client resolves and a session (or its absence) is known, so the signed-in
    // header never flickers signed-out → signed-in. A later auth event can still
    // hydrate the session after this boundary.
    const loadingTimeout = window.setTimeout(() => {
      if (active) setLoading(false);
    }, 2500);

    // Lazy-load the browser client (dynamic import) off the critical path, then
    // subscribe and restore. Everything client-dependent runs after it resolves.
    void ensureSupabaseBrowser().then((supabase) => {
      if (!active) return;

      // Unconfigured / SSR-only: nothing to subscribe to.
      if (!supabase) {
        window.clearTimeout(loadingTimeout);
        setLoading(false);
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
        setSession(nextSession ?? null);
        setLoading(false);
        // Wave L3: on sign-in, maybe open Claim your night (never silent overwrite).
        if (event === "SIGNED_IN" && nextSession?.user) {
          const u = nextSession.user;
          posthog.identify(u.id, {
            ...(u.email ? { email: u.email } : {}),
          });
          posthog.capture("user_signed_in");
          void syncIdentityAfterSignIn(u);
        }
        if (event === "SIGNED_OUT") {
          posthog.capture("user_signed_out");
          posthog.reset();
          try {
            window.sessionStorage.removeItem(SYNCED_USER_KEY);
          } catch {
            // ignore
          }
          clearClaimDeferred();
          closeClaim();
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
          setSession(exchangedSession);
          setLoading(false);
          posthog.identify(exchangedSession.user.id, {
            ...(exchangedSession.user.email ? { email: exchangedSession.user.email } : {}),
          });
          void syncIdentityAfterSignIn(exchangedSession.user);
          return;
        }

        try {
          const { data } = await supabase.auth.getSession();
          if (!active) return;
          window.clearTimeout(loadingTimeout);
          setSession(data.session ?? null);
          setLoading(false);
          // Wave L3: refresh identity sync for an already-persisted session.
          if (data.session?.user) {
            posthog.identify(data.session.user.id, {
              ...(data.session.user.email ? { email: data.session.user.email } : {}),
            });
            void syncIdentityAfterSignIn(data.session.user);
          }
        } catch {
          if (!active) return;
          window.clearTimeout(loadingTimeout);
          setLoading(false);
        }
      })();
    });

    return () => {
      active = false;
      window.clearTimeout(loadingTimeout);
      subscription?.unsubscribe();
    };
  }, [closeClaim, syncIdentityAfterSignIn]);

  const signInWithGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = await ensureSupabaseBrowser();
    if (!supabase) {
      return { error: "Sign-in is not configured." };
    }
    // origin is only read inside this handler (post-mount, browser-only), so it
    // is SSR-safe. redirectTo must be an allowed URL in Supabase Auth settings.
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    const attempt = await prepareAuthCallback(window.location.href);
    if (!attempt.ok) return { error: attempt.message };
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

  const signInWithMicrosoft = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = await ensureSupabaseBrowser();
    if (!supabase) {
      return { error: "Sign-in is not configured." };
    }
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    const attempt = await prepareAuthCallback(window.location.href);
    if (!attempt.ok) return { error: attempt.message };
    // Supabase's Microsoft provider id is "azure". Request email so we can
    // derive a handle the same way as Google.
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          scopes: "email",
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

  const signInWithEmail = useCallback(
    async (email: string, next?: string): Promise<MagicLinkResult> => {
      const supabase = await ensureSupabaseBrowser();
      if (!supabase) {
        return { status: "error", message: "Sign-in is not configured." };
      }
      if (typeof window === "undefined") {
        return { status: "error", message: "Sign-in is unavailable on this page." };
      }
      const attempt = await prepareAuthCallback(window.location.href, next);
      if (!attempt.ok) return { status: "error", message: attempt.message };
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
    return {
      session,
      user,
      loading,
      configured,
      signInWithGoogle,
      signInWithMicrosoft,
      signInWithEmail,
      cancelAuthAttempt: cancelBrowserAuthAttempt,
      signOut,
      handle: canonicalHandle ?? handleFromUser(user),
    };
  }, [session, loading, configured, signInWithGoogle, signInWithMicrosoft, signInWithEmail, signOut, canonicalHandle]);

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
      <IdentityNudge />
      {claimPreview ? (
        <ClaimNightDialog
          preview={claimPreview}
          busy={claimBusy}
          error={claimError}
          onConfirm={onClaimConfirm}
          onSkip={onClaimSkip}
        />
      ) : null}
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
    signInWithGoogle: async () => ({ error: "Sign-in is not configured." }),
    signInWithMicrosoft: async () => ({ error: "Sign-in is not configured." }),
    signInWithEmail: async () => ({ status: "error", message: "Sign-in is not configured." }),
    cancelAuthAttempt: () => {},
    signOut: async () => {},
    handle: null,
  };
}
