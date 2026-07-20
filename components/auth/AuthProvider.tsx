"use client";

// App-wide auth context. Holds the current Supabase session/user (or null) and
// exposes signInWithGoogle()/signInWithMicrosoft()/signOut(). Additive only:
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

import { ClaimNightDialog } from "@/components/auth/ClaimNightDialog";
import IdentityNudge from "@/components/identity/IdentityNudge";
import { trackEvent } from "@/lib/analytics";
import { getSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import { authedFetch } from "@/lib/authedFetch";
import type { ClaimChoice, ClaimPreview } from "@/lib/identityClaim";
import { readDeviceHandle } from "@/lib/identityClaimClient";
import { normalizeHandle } from "@/lib/profiles";
import { emitIdentityHandleChanged, IDENTITY_HANDLE_CHANGED_EVENT } from "@/lib/identityClient";

const HANDLE_KEY = "pubmax_handle";
const SYNCED_USER_KEY = "pubmax_identity_synced_user";
const CLAIM_DEFERRED_KEY = "pubmax_claim_deferred";

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
  const configured = isAuthConfigured();
  // Guard overlapping sync runs (getSession + SIGNED_IN can both fire).
  const syncInFlight = useRef<string | null>(null);

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
    // Session restoration is additive; it must never hold the anonymous app or
    // Pub Pal onboarding behind an infinite loading screen when the provider is
    // slow, blocked, or temporarily unavailable. A later auth event can still
    // hydrate the session after this fail-soft boundary.
    const loadingTimeout = window.setTimeout(() => {
      if (active) setLoading(false);
    }, 2500);

    // Prime from any persisted session (async → setState is safe here).
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        window.clearTimeout(loadingTimeout);
        setSession(data.session ?? null);
        setLoading(false);
        // Wave L3: refresh identity sync for an already-persisted session.
        if (data.session?.user) void syncIdentityAfterSignIn(data.session.user);
      })
      .catch(() => {
        if (!active) return;
        window.clearTimeout(loadingTimeout);
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
      // Wave L3: on sign-in, maybe open Claim your night (never silent overwrite).
      if (event === "SIGNED_IN" && nextSession?.user) {
        void syncIdentityAfterSignIn(nextSession.user);
      }
      if (event === "SIGNED_OUT") {
        try {
          window.sessionStorage.removeItem(SYNCED_USER_KEY);
        } catch {
          // ignore
        }
        clearClaimDeferred();
        closeClaim();
      }
    });

    return () => {
      active = false;
      window.clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, [closeClaim, syncIdentityAfterSignIn]);

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

  const signInWithMicrosoft = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      return { error: "Sign-in is not configured." };
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // Supabase's Microsoft provider id is "azure". Request email so we can
    // derive a handle the same way as Google.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email",
        redirectTo: `${origin}/auth/callback`,
      },
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
      signInWithMicrosoft,
      signOut,
      handle: canonicalHandle ?? handleFromUser(user),
    };
  }, [session, loading, configured, signInWithGoogle, signInWithMicrosoft, signOut, canonicalHandle]);

  return (
    <AuthContext.Provider value={value}>
      {children}
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
    signOut: async () => {},
    handle: null,
  };
}
