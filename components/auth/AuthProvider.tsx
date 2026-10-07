"use client";

// App-wide auth context. Holds the current Supabase session/user (or null) and
// exposes Google, Apple, Microsoft, passwordless email, and sign-out actions. Additive only:
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import "@/app/auth/auth.css";
import AuthAccountBannedNotice from "@/components/auth/AuthAccountBannedNotice";
import ArrivalWelcome from "@/components/auth/ArrivalWelcome";
import AccountOnboarding from "@/components/identity/AccountOnboarding";
import IdentityNudge from "@/components/identity/IdentityNudge";
import { markArrival, takeChosenIntent } from "@/lib/arrivalWelcome";
import { forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import { oauthOpensInSystemBrowser, openOAuthInSystemBrowser } from "@/lib/nativeOAuth";
import {
  accountComposerAuth,
  captureAccountAuth,
  rejectAccountAuth,
  sameAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import { isUserSignUp } from "@/lib/userSignedUp";
import {
  authCallbackConfirmationLabel,
  clearLegacyPkceVerifiers,
  fetchAuthCallbackUser,
  prepareAuthCallbackSession,
  type AuthCallbackSessionResult,
  type PreparedAuthCallbackSession,
} from "@/lib/authCallbackClient";
import { ensureSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import { loadAuthClientWithRetry } from "@/lib/authClientLoad";
import { requestDeploymentSkewCheck } from "@/lib/deploymentSkewRecovery";
import {
  guardSocialAuthProvider,
  loadSocialAuthProviders,
  NO_SOCIAL_AUTH_PROVIDERS,
  type SocialAuthProviderAvailability,
} from "@/lib/authProviderAvailability";
import { createAuthSessionTransitionTracker } from "@/lib/authSessionTransition";
import {
  bindDeviceAccountOwner,
  emitDeviceIdentityChanged,
  releaseDeviceAccountOwner,
} from "@/lib/deviceAccountIdentity";
import {
  emitDeviceAccountSessionsChanged,
  forgetAllDeviceAccounts,
  forgetDeviceAccount,
  nextSignedInDeviceAccount,
  readDeviceAccounts,
  rememberDeviceAccount,
} from "@/lib/deviceAccountSessions";
import {
  activateDeviceAccount,
  browserDeviceAccountSwitchDeps,
  mintSessionFromRefreshToken,
  type DeviceAccountSwitchOutcome,
} from "@/lib/deviceAccountSwitch";
import {
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT,
  beginCanonicalAuthAttempt,
  cancelAuthAttempt,
  defaultEmailAuthNext,
  releaseAuthAttempt,
  scrubAuthCallback,
  scrubLingeringAuthCallback,
  type CanonicalAuthAttemptStart,
  type AuthCallbackAttempt,
  type CapturedAuthCallback,
} from "@/lib/authRedirect";
import { authedActionFetch, publishAuthActionState } from "@/lib/authedFetch";
import { normalizeHandle } from "@/lib/profiles";
import {
  claimSignupReferralFromAuthCallback,
  withReferralSignupProof,
} from "@/lib/referralClaimClient";
import {
  handleClaimRouteAfterSignIn,
  IDENTITY_HANDLE_CHANGED_EVENT,
  identityHandleForOwner,
  resolveCanonicalIdentity,
  type IdentityHandleChangedDetail,
} from "@/lib/identityClient";
import {
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS,
  bootstrapAuthSession,
} from "@/lib/authSessionBootstrap";
import {
  clearPersistedSession,
  persistSessionForResume,
  markResumePersisted,
  resumeAlreadyPersisted,
  requestResumeLink,
  type ResumeHint,
} from "@/lib/authSessionResumeClient";
import { authAccountBanMessageFromError } from "@/lib/authAccountBan";
import { requestMagicLink, type MagicLinkResult } from "@/lib/passwordlessAuth";
import {
  readProviderAuthState,
  readProviderIdentityRevision,
  resolveSupabaseAuthState,
  setProviderAuthState,
  setProviderIdentity,
  subscribeProviderIdentityRevision,
} from "@/lib/authProviderRevision";
import {
  AuthContext,
  type AuthContextValue,
  type SignOutScope,
} from "@/components/auth/authContext";

export type { AuthContextValue, SignOutScope } from "@/components/auth/authContext";
export { useAuth } from "@/components/auth/authContext";

const AUTH_CALLBACK_ERROR_MESSAGE =
  "Sign-in could not be completed. The link may be invalid or expired. Try again.";

function signedInAsMessage(user: User): string {
  const address = authCallbackConfirmationLabel({
    id: user.id,
    email: user.email,
    emailConfirmedAt: user.email_confirmed_at,
  });
  return address ? `Signed in as ${address}.` : "Signed in.";
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

/**
 * Copy an account's OWN canonical handle onto its OWN row in the remembered
 * account lane, so the switcher lists people rather than email addresses.
 *
 * This is not a second identity authority. The row is keyed by the account id
 * the handle was read for, nothing reads "who is signed in" from the lane, and a
 * row is only ever activated by minting that row's own session. The one place
 * identity binds is still `updateSession`.
 */
function rememberAccountHandle(userId: string, handle: string | null): void {
  if (!handle) return;
  rememberDeviceAccount(
    browserLocalStorage(),
    { userId, handle },
    Date.now(),
  );
  emitDeviceAccountSessionsChanged();
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

/**
 * Defect fence: callback tokens must leave the address bar on every path -
 * success, failure, or a first replaceState the browser refused or a router
 * write reverted. Runs after the exchange settles and once more on a delay.
 */
function scrubLingeringBrowserAuthCallback(): void {
  scrubLingeringAuthCallback(window.location.href, (cleanUrl) =>
    window.history.replaceState(window.history.state, "", cleanUrl),
  );
}

/**
 * Persist the durable resume cookie, and when the server refuses the bearer
 * token, try once more with whatever the client holds NOW.
 *
 * A restored session can hand back an access token that is already past its
 * expiry - supabase-js refreshes it moments later - and /api/auth/session
 * verifies that token before it will store anything. The first attempt then
 * 401s, nothing is written, and the device is left with no durable session at
 * all. One retry against the refreshed session closes that window; a second
 * failure is left to the next TOKEN_REFRESHED.
 */
async function persistSessionWithRetry(
  auth: { getSession: () => Promise<{ data: { session: Session | null } }> },
  session: Session,
  options: { skipIfRecent?: boolean } = {},
): Promise<void> {
  const storage = browserLocalStorage();
  // A page load re-reads a session whose token the cookie already holds. That
  // is not a reason to spend the endpoint's per-IP budget again.
  if (options.skipIfRecent && resumeAlreadyPersisted(storage, session)) return;
  const outcome = await persistSessionForResume(session);
  if (outcome === "stored") markResumePersisted(storage, session);
  if (outcome !== "unauthenticated") return;
  const refreshed = await auth
    .getSession()
    .then(({ data }) => data.session ?? null)
    .catch(() => null);
  if (!refreshed || refreshed.access_token === session.access_token) return;
  if ((await persistSessionForResume(refreshed)) === "stored") {
    markResumePersisted(storage, refreshed);
  }
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

/** How far a sign-out reaches: this account, or every account on this device. */
// SignOutScope and AuthContextValue live in authContext.tsx for a thin import
// path off the map shell chunk.

/**
 * The app's answer to "who is this?". A canonical read that has not landed, or
 * one that failed, is UNKNOWN - never the previous account's cached handle and
 * never a confident "no handle".
 */
type CanonicalIdentityState =
  | Readonly<{ status: "unknown" }>
  | Readonly<{ status: "resolved"; identity: IdentityHandleChangedDetail | null }>;

const UNKNOWN_IDENTITY: CanonicalIdentityState = { status: "unknown" };
const NOBODY_IDENTITY: CanonicalIdentityState = {
  status: "resolved",
  identity: null,
};

export function AuthProvider({
  children,
  clerkIntegrationConfigured,
}: {
  children?: ReactNode;
  clerkIntegrationConfigured: boolean;
}): React.JSX.Element {
  const accountRevision = useSyncExternalStore(
    subscribeProviderIdentityRevision,
    readProviderIdentityRevision,
    () => 0,
  );
  const [session, setSession] = useState<Session | null>(null);
  // Who the app may say this is. "unknown" is not "nobody": a signed-in account
  // whose canonical handle has not come back yet must render neutral rather
  // than fall back to whatever the device had cached, because that cache is
  // exactly what belonged to the account before this one.
  const [canonicalIdentityState, setCanonicalIdentityState] =
    useState<CanonicalIdentityState>(UNKNOWN_IDENTITY);
  const [identityReadAttempt, setIdentityReadAttempt] = useState(0);
  const retryIdentity = useCallback(() => setIdentityReadAttempt((attempt) => attempt + 1), []);
  // Session restore only applies when Supabase public env is present. When it
  // is not, there is nothing to wait for — derive `loading` false during render
  // instead of setState-in-effect (which cascaded a second render on every
  // mount and made the Sign in control flicker).
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null);
  const [authBannedNotice, setAuthBannedNotice] = useState(false);
  const [authCallbackConfirmation, setAuthCallbackConfirmation] = useState<{
    label: string | null;
    confirm: () => void;
  } | null>(null);
  /** Confirmation receipt after an unowned callback is accepted. */
  const [authSignedInNotice, setAuthSignedInNotice] = useState<string | null>(null);
  const [socialProviderRead, setSocialProviders] =
    useState<SocialAuthProviderAvailability | null>(null);
  const socialProviders = socialProviderRead ?? NO_SOCIAL_AUTH_PROVIDERS;
  const [welcomeBack, setWelcomeBack] = useState<ResumeHint | null>(null);
  const [rejectedContributionAuth, setRejectedContributionAuth] =
    useState<AccountAuthSnapshot | null>(null);
  const rejectedContributionAuthRef =
    useRef<AccountAuthSnapshot | null>(null);
  const configured = isAuthConfigured();
  const loading = configured && sessionLoading;
  const supabaseProviderState = readProviderAuthState("supabase");
  const clerkProviderState = readProviderAuthState("clerk");
  const providerAuthState =
    (configured && supabaseProviderState === "unresolved") ||
    (clerkIntegrationConfigured && clerkProviderState === "unresolved")
      ? "unresolved"
      : supabaseProviderState === "authenticated" ||
          (clerkIntegrationConfigured && clerkProviderState === "authenticated")
        ? "authenticated"
        : supabaseProviderState === "unavailable"
          ? "unavailable"
          : "signed-out";
  const sessionTransitions = useRef(createAuthSessionTransitionTracker());
  const updateSession = useCallback(
    (nextSession: Session | null, event: string | null = null) => {
      const previousUserId = sessionTransitions.current.currentUserId();
      const nextUserId = nextSession?.user.id ?? null;
      const signedIn = sessionTransitions.current.update(event, nextUserId);
      const nextProviderAuthState = resolveSupabaseAuthState(
        event === "INITIAL_SESSION" ? "initial-session" : "auth-event",
        nextSession !== null,
        sessionTransitions.current.currentUserId(),
      );
      if (nextProviderAuthState) {
        setProviderAuthState("supabase", nextProviderAuthState);
      }
      setProviderIdentity("supabase", nextUserId);
      // THE BOUNDARY. Before any child re-renders on the new session, bind this
      // device's cached identity to the account that now owns it. A different
      // account - or a device carrying artifacts nobody stamped - loses the
      // whole set in one pass, so the previous person's handle can never be
      // read as this one's. Runs first because everything downstream (the
      // canonical read, the You tab, every composer) reads that storage.
      if (nextUserId) {
        if (bindDeviceAccountOwner(nextUserId, browserLocalStorage(), browserSessionStorage())) {
          emitDeviceIdentityChanged();
        }
      }
      if (previousUserId !== nextUserId) {
        // A new account is owed a fresh answer, and no answer is honest until
        // its own canonical read lands.
        setCanonicalIdentityState(nextUserId ? UNKNOWN_IDENTITY : NOBODY_IDENTITY);
      }
      const nextAuth = captureAccountAuth(nextUserId, nextSession);
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

  useEffect(() => {
    setProviderAuthState("supabase", configured ? "unresolved" : "signed-out");
  }, [configured]);
  // React Strict Mode replays effects in development. Reuse one completion so
  // the callback tokens are never applied twice by the replayed mount effect.
  const callbackSessionInFlight = useRef<
    Promise<PreparedAuthCallbackSession<Session>> | null
  >(null);

  const sessionBootstrapInFlight = useRef<ReturnType<typeof bootstrapAuthSession> | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void loadSocialAuthProviders().then((availability) => {
      if (active) {
        setSocialProviders(availability ?? NO_SOCIAL_AUTH_PROVIDERS);
      }
    });
    return () => {
      active = false;
    };
  }, [configured]);
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
        setCanonicalIdentityState({
          status: "resolved",
          identity: { ownerId: user.id, handle: normalizeHandle(handle) },
        });
        rememberAccountHandle(user.id, normalizeHandle(handle));
      }
    };
    window.addEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
    async function loadCanonicalHandle() {
      if (!user) {
        if (active) setCanonicalIdentityState(NOBODY_IDENTITY);
        return;
      }
      const resolution = await resolveCanonicalIdentity(
        user.id,
        session,
        browserLocalStorage(),
      ).catch(() => null);
      // A read that failed is not evidence the account has no handle, so the
      // answer stays unknown rather than becoming a confident "nobody".
      if (!active || !resolution?.ok) return;
      setCanonicalIdentityState({
        status: "resolved",
        identity: resolution.identity,
      });
      rememberAccountHandle(
        user.id,
        identityHandleForOwner(resolution.identity, user.id),
      );
    }
    void loadCanonicalHandle();
    return () => {
      active = false;
      window.removeEventListener(IDENTITY_HANDLE_CHANGED_EVENT, onChanged);
    };
  }, [session, identityReadAttempt]);

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
    // Even with no exchange to run (unconfigured, missing client), the sweep
    // still owes the address bar a clean URL: a scrub the browser refused or a
    // router write reverted must not leave one-time credentials on show.
    const lingeringSweepTimeout = window.setTimeout(
      scrubLingeringBrowserAuthCallback,
      2_000,
    );

    const reportCallbackFailure = (callbackAttempt: AuthCallbackAttempt | null) => {
      if (callbackAttempt) setAuthCallbackError(AUTH_CALLBACK_ERROR_MESSAGE);
    };

    if (!configured) {
      let active = true;
      void callbackCapture.then((captured) => {
        const callbackAttempt = captured?.attempt ?? null;
        if (callbackAttempt?.attemptId) {
          releaseBrowserAuthAttempt(callbackAttempt.attemptId);
        }
        captured?.releaseCoordination();
        scrubLingeringBrowserAuthCallback();
        if (!active) return;
        reportCallbackFailure(callbackAttempt);
      });
      return () => {
        active = false;
        window.clearTimeout(lingeringSweepTimeout);
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
      if (!active) return;
      const timeoutAuthState = resolveSupabaseAuthState(
        "timeout",
        sessionTransitions.current.currentUserId() !== null,
        sessionTransitions.current.currentUserId(),
      );
      if (timeoutAuthState) setProviderAuthState("supabase", timeoutAuthState);
      setSessionLoading(false);
    }, AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS);

    // Lazy-load the browser client (dynamic import) off the critical path, then
    // subscribe and restore. Everything client-dependent runs after it resolves.
    //
    // The load can REJECT (a deploy moved the chunk, the connection dropped
    // mid-download). That is a read we could not run, not an answer about the
    // viewer, so it is retried and then published as unavailable - never as a
    // confident sign-out. An unhandled rejection here used to leave the 20
    // second ceiling to settle it, and every page in the tab then painted its
    // signed-out variant over an intact session (lib/authClientLoad.ts).
    void loadAuthClientWithRetry(ensureSupabaseBrowser, {
      delay: (ms) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms);
        }),
    }).then((outcome) => {
      if (!active) return;

      if (outcome.status === "unavailable") {
        // Say nothing about the viewer and stop the ceiling from saying it for
        // us. A stale document is the likeliest cause, so ask the deployment
        // skew check to run: it reloads onto the current deployment, and its
        // own guards refuse a loop or a page with unsaved input.
        window.clearTimeout(loadingTimeout);
        setProviderAuthState("supabase", "unavailable");
        setSessionLoading(false);
        void callbackCapture
          .then((captured) => {
            const callbackAttempt = captured?.attempt ?? null;
            if (callbackAttempt?.attemptId) {
              releaseBrowserAuthAttempt(callbackAttempt.attemptId);
            }
            captured?.releaseCoordination();
            scrubLingeringBrowserAuthCallback();
            if (!active) return;
            reportCallbackFailure(callbackAttempt);
          })
          .finally(() => {
            requestDeploymentSkewCheck();
          });
        return;
      }

      const supabase = outcome.status === "ready" ? outcome.client : null;

      // Unconfigured / SSR-only: nothing to subscribe to.
      if (!supabase) {
        window.clearTimeout(loadingTimeout);
        const unavailableAuthState = resolveSupabaseAuthState(
          "bootstrap",
          false,
          sessionTransitions.current.currentUserId(),
        );
        if (unavailableAuthState) {
          setProviderAuthState("supabase", unavailableAuthState);
        }
        setSessionLoading(false);
        void callbackCapture.then((captured) => {
          const callbackAttempt = captured?.attempt ?? null;
          if (callbackAttempt?.attemptId) {
            releaseBrowserAuthAttempt(callbackAttempt.attemptId);
          }
          captured?.releaseCoordination();
          scrubLingeringBrowserAuthCallback();
          if (!active) return;
          reportCallbackFailure(callbackAttempt);
        });
        return;
      }

      // Live updates: SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED. The callback is
      // the ONLY place these setStates run — never the effect body.
      const registration = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (!active) return;
        // A refresh or the first read changes nothing about who this is. Any
        // other event may have (a new password, another sign-in), so the page's
        // shared identity read is dropped and the next surface asks again.
        if (event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") {
          forgetCurrentIdentityRead();
        }
        const signedIn = updateSession(nextSession ?? null, event);
        // INITIAL_SESSION with no local session is only the beginning of a
        // cold boot. The durable cookie still needs to be checked before the
        // app can honestly publish a signed-out state.
        if (event !== "INITIAL_SESSION" || nextSession) {
          setSessionLoading(false);
        }
        if (nextSession) {
          setWelcomeBack(null);
          // The device's remembered-account lane mirrors the SAME refresh token
          // the durable cookie mirrors, for every account rather than only the
          // active one, so the switcher has something to switch back to. Same
          // trigger, same evictable storage, no access token
          // (lib/deviceAccountSessions.ts). Every event carrying a session
          // qualifies, because a rotation the lane missed is a dead door.
          rememberDeviceAccount(
            browserLocalStorage(),
            {
              userId: nextSession.user.id,
              refreshToken: nextSession.refresh_token,
              email: nextSession.user.email ?? null,
            },
            Date.now(),
          );
          emitDeviceAccountSessionsChanged();
          // Keep the durable resume cookie current: every sign-in, restore and
          // background token rotation re-extends its 30-day window and stores
          // the newest refresh token (lib/authSessionResume.ts). A switch lands
          // here too, which is the whole of how the cookie follows the ACTIVE
          // account: `setSession` fires SIGNED_IN, this re-persists, and
          // `inheritedResumeEmail` refuses to carry the previous account's
          // address across because the account id differs.
          if (
            event === "SIGNED_IN" ||
            event === "TOKEN_REFRESHED" ||
            event === "INITIAL_SESSION"
          ) {
            void persistSessionWithRetry(supabase.auth, nextSession, {
              skipIfRecent: event === "INITIAL_SESSION",
            });
          }
        }
        if (event === "SIGNED_IN" && nextSession?.user) {
          if (signedIn) {
            if (isUserSignUp(nextSession.user, Date.now())) trackEvent("user_signed_up");
            trackEvent("user_signed_in");
            // A GENUINE sign-in transition, which is the only thing that earns
            // a greeting. An ordinary page load with a live session never
            // reaches here, so returning to the map does not re-announce you.
            // The email-link callback lands here too: establishAuthCallbackSession
            // calls setSession, which fires SIGNED_IN through this subscription.
            markArrival(
              browserSessionStorage(),
              takeChosenIntent(browserLocalStorage(), Date.now()),
              Date.now(),
            );
          }
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

      // Prime from callback tokens or any persisted session. Completion is
      // explicit so expired-link, missing-token, and network failures become
      // visible and one-time URL state is removed on both success and failure.
      const finishCallbackExchange = (
        exchange: AuthCallbackSessionResult<Session>,
        captured: CapturedAuthCallback,
      ) => {
        if (!active) return;
        const callbackAttempt = captured.attempt;
        if (exchange.banned) {
          setAuthBannedNotice(true);
          setAuthCallbackError(null);
          void supabase.auth.signOut({ scope: "local" });
        } else if (exchange.failed) setAuthCallbackError(AUTH_CALLBACK_ERROR_MESSAGE);

        const exchangedSession = exchange.session;
        if (exchangedSession) {
          window.clearTimeout(loadingTimeout);
          updateSession(exchangedSession);
          setSessionLoading(false);
          if (!captured.localAttemptOwned) {
            setAuthSignedInNotice(
              signedInAsMessage(exchangedSession.user),
            );
          }
          // The PKCE flow this app ran before left one-time code-verifier keys
          // behind; the implicit flow never clears them, so sweep them here.
          clearLegacyPkceVerifiers(browserLocalStorage());
          const referralClaimed = claimSignupReferralFromAuthCallback({
            currentUrl: window.location.href,
            callback: callbackAttempt,
            request: (input, init) =>
              authedActionFetch(input, init ?? {}, { requiresIdentity: true }),
            replaceUrl: (cleanUrl) => {
              window.history.replaceState(window.history.state, "", cleanUrl);
            },
          });
          // Account first, handle second: once the referral claim settles (a
          // navigation would abort its in-flight request), an account with no
          // claimed handle lands on the claim surface.
          void referralClaimed
            .catch(() => {})
            .then(() =>
              handleClaimRouteAfterSignIn(
                exchangedSession,
                captured.cleanUrl,
                browserLocalStorage(),
              ),
            )
            .then((destination) => {
              if (destination && active) window.location.assign(destination);
            })
            .catch(() => {});
        }
      };

      const publishBootstrappedSession = (
        bootstrapped: Awaited<ReturnType<typeof bootstrapAuthSession>>,
      ) => {
        window.clearTimeout(loadingTimeout);
        if (bootstrapped.status === "unavailable") {
          if (readProviderAuthState("supabase") === "unresolved") {
            setProviderAuthState("supabase", "unavailable");
          }
        } else if (bootstrapped.status === "local") {
          // INITIAL_SESSION normally supplied this same session already. The
          // explicit update also covers a client that did not emit that event.
          updateSession(bootstrapped.session);
        } else if (bootstrapped.status === "banned") {
          setAuthBannedNotice(true);
        } else if (bootstrapped.status === "expired") {
          setWelcomeBack({ maskedEmail: bootstrapped.maskedEmail });
        }
        if (bootstrapped.status !== "unavailable") {
          const bootstrapAuthState = resolveSupabaseAuthState(
            "bootstrap",
            sessionTransitions.current.currentUserId() !== null,
            sessionTransitions.current.currentUserId(),
          );
          if (bootstrapAuthState) {
            setProviderAuthState("supabase", bootstrapAuthState);
          }
        }
        // A restored result has already awaited auth.setSession. Supabase emits
        // SIGNED_IN through the subscription above, so the session and identity
        // boundary are updated before this loading state is cleared.
        setSessionLoading(false);
      };

      void (async () => {
        await Promise.resolve();
        const captured = await callbackCapture;
        if (!active) return;
        const callbackAttempt = captured?.attempt ?? null;
        let exchange: AuthCallbackSessionResult<Session> | null = null;
        let verificationFailed = false;
        let unownedAccountBanned = false;
        let confirmation: Extract<PreparedAuthCallbackSession<Session>, { status: "confirmation-required" }> | null = null;
        try {
          if (captured && callbackAttempt?.tokens && !callbackAttempt.providerError) {
            if (!callbackSessionInFlight.current) {
              callbackSessionInFlight.current = prepareAuthCallbackSession(
                supabase.auth,
                callbackAttempt.tokens,
                captured.localAttemptOwned,
                (refreshToken) =>
                  mintSessionFromRefreshToken(
                    refreshToken,
                    browserDeviceAccountSwitchDeps(),
                  ),
                (accessToken) => fetchAuthCallbackUser(accessToken, browserDeviceAccountSwitchDeps()),
              );
            }
            const prepared = await callbackSessionInFlight.current;
            if (!active) return;
            if (prepared.status === "established") {
              exchange = prepared.result;
            } else if (prepared.status === "confirmation-required") {
              confirmation = prepared;
            } else if (prepared.status === "banned") {
              unownedAccountBanned = true;
            } else {
              verificationFailed = true;
            }
          }
        } finally {
          if (callbackAttempt?.attemptId) {
            releaseBrowserAuthAttempt(callbackAttempt.attemptId);
          }
          captured?.releaseCoordination();
        }
        // Scrub again even when confirmation is pending or verification failed.
        scrubLingeringBrowserAuthCallback();
        if (!active) return;
        if (exchange && captured) finishCallbackExchange(exchange, captured);
        if (unownedAccountBanned) {
          setAuthBannedNotice(true);
          setAuthCallbackError(null);
        } else if (
          verificationFailed ||
          (callbackAttempt && (callbackAttempt.providerError || !callbackAttempt.tokens))
        ) {
          setAuthCallbackError(AUTH_CALLBACK_ERROR_MESSAGE);
        }
        if (exchange?.session) return;

        const bootstrapped = await (sessionBootstrapInFlight.current ??= bootstrapAuthSession(supabase.auth).catch(
          () => ({ status: "unavailable" } as const),
        ));
        if (!active) return;
        publishBootstrappedSession(bootstrapped);
        if (confirmation && captured) {
          const prepared = confirmation;
          setAuthCallbackConfirmation({
            label: prepared.identity.label,
            confirm: () => {
              void prepared.confirm().then((confirmed) => {
                finishCallbackExchange(confirmed, captured);
              });
            },
          });
        }
      })();
    });

    return () => {
      active = false;
      window.clearTimeout(loadingTimeout);
      window.clearTimeout(lingeringSweepTimeout);
      subscription?.unsubscribe();
    };
  }, [configured, updateSession]);

  // Inside the native shell the provider page opens in the system browser
  // (lib/nativeOAuth.ts): Google refuses OAuth in an embedded web view, and the
  // universal link /auth/callback brings the person back to this WebView. On
  // the web supabase-js has already navigated by the time this runs.
  const handOffToSystemBrowser = useCallback(
    async (systemBrowser: boolean, url: string | null | undefined, attemptId: string) => {
      if (!systemBrowser) return { error: null };
      if (!url) {
        releaseBrowserAuthAttempt(attemptId);
        return { error: "Sign-in could not be started. Try again." };
      }
      const outcome = await openOAuthInSystemBrowser(url);
      if (outcome === "opened") return { error: null };
      // No system browser to hand to: take the web's own path.
      window.location.assign(url);
      return { error: null };
    },
    [],
  );

  const startSupabaseGoogleOAuth = useCallback(async (next?: string): Promise<{ error: string | null }> => {
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    const attempt = await prepareAuthCallback(window.location.href, next);
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
      const systemBrowser = oauthOpensInSystemBrowser();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: attempt.callbackUrl,
          ...(systemBrowser ? { skipBrowserRedirect: true } : {}),
        },
      });
      if (error) {
        releaseBrowserAuthAttempt(attempt.id);
        return { error: authAccountBanMessageFromError(error) ?? error.message };
      }
      return handOffToSystemBrowser(systemBrowser, data?.url, attempt.id);
    } catch {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in could not be started. Try again." };
    }
  }, [handOffToSystemBrowser]);

  const startSupabaseAppleOAuth = useCallback(async (next?: string): Promise<{ error: string | null }> => {
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    const attempt = await prepareAuthCallback(window.location.href, next);
    if ("navigationStarted" in attempt) return { error: null };
    if (!attempt.ok) return { error: attempt.message };
    const supabase = await ensureSupabaseBrowser().catch(() => null);
    if (!supabase) {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in is not configured." };
    }
    try {
      const systemBrowser = oauthOpensInSystemBrowser();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: attempt.callbackUrl,
          ...(systemBrowser ? { skipBrowserRedirect: true } : {}),
        },
      });
      if (error) {
        releaseBrowserAuthAttempt(attempt.id);
        return { error: authAccountBanMessageFromError(error) ?? error.message };
      }
      return handOffToSystemBrowser(systemBrowser, data?.url, attempt.id);
    } catch {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in could not be started. Try again." };
    }
  }, [handOffToSystemBrowser]);

  const startSupabaseMicrosoftOAuth = useCallback(async (next?: string): Promise<{ error: string | null }> => {
    if (typeof window === "undefined") return { error: "Sign-in is unavailable on this page." };
    const attempt = await prepareAuthCallback(window.location.href, next);
    if ("navigationStarted" in attempt) return { error: null };
    if (!attempt.ok) return { error: attempt.message };
    const supabase = await ensureSupabaseBrowser().catch(() => null);
    if (!supabase) {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in is not configured." };
    }
    try {
      const systemBrowser = oauthOpensInSystemBrowser();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: attempt.callbackUrl,
          scopes: "email openid profile",
          ...(systemBrowser ? { skipBrowserRedirect: true } : {}),
        },
      });
      if (error) {
        releaseBrowserAuthAttempt(attempt.id);
        return { error: error.message };
      }
      return handOffToSystemBrowser(systemBrowser, data?.url, attempt.id);
    } catch {
      releaseBrowserAuthAttempt(attempt.id);
      return { error: "Sign-in could not be started. Try again." };
    }
  }, [handOffToSystemBrowser]);

  const signInWithGoogle = useCallback(async (next?: string): Promise<{ error: string | null }> => {
    const guarded = await guardSocialAuthProvider(
      "google",
      () => startSupabaseGoogleOAuth(next),
      () => loadSocialAuthProviders(globalThis.fetch, { fresh: true }),
    );
    setSocialProviders(guarded.availability ?? NO_SOCIAL_AUTH_PROVIDERS);
    return guarded.result;
  }, [startSupabaseGoogleOAuth]);

  const signInWithApple = useCallback(async (next?: string): Promise<{ error: string | null }> => {
    const guarded = await guardSocialAuthProvider(
      "apple",
      () => startSupabaseAppleOAuth(next),
      () => loadSocialAuthProviders(globalThis.fetch, { fresh: true }),
    );
    setSocialProviders(guarded.availability ?? NO_SOCIAL_AUTH_PROVIDERS);
    return guarded.result;
  }, [startSupabaseAppleOAuth]);

  const signInWithMicrosoft = useCallback(async (next?: string): Promise<{ error: string | null }> => {
    const guarded = await guardSocialAuthProvider(
      "microsoft",
      () => startSupabaseMicrosoftOAuth(next),
      () => loadSocialAuthProviders(globalThis.fetch, { fresh: true }),
    );
    setSocialProviders(guarded.availability ?? NO_SOCIAL_AUTH_PROVIDERS);
    return guarded.result;
  }, [startSupabaseMicrosoftOAuth]);

  const signInWithEmail = useCallback(
    async (email: string, next?: string): Promise<MagicLinkResult> => {
      if (typeof window === "undefined") {
        return { status: "error", message: "Sign-in is unavailable on this page." };
      }
      const attempt = await prepareAuthCallback(
        window.location.href,
        next ?? defaultEmailAuthNext(window.location.href),
      );
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

  const signOut = useCallback(
    async (scope: SignOutScope = "account"): Promise<void> => {
      const supabase = await ensureSupabaseBrowser();
      if (!supabase) return;
      const departing = sessionTransitions.current.currentUserId();
      // Explicit sign-out is the one place the durable resume cookie dies too —
      // a transient SIGNED_OUT (failed refresh) must keep it for silent restore.
      // AWAITED, because an account sign-out may hand the device straight to the
      // next remembered account: a DELETE still in flight would land after that
      // account's persist and leave the device with no durable session at all.
      await clearPersistedSession();
      // The same set the account boundary clears, and the owner stamp with it.
      // Leaving the handle behind is what let the next account inherit it: the
      // session went and its name stayed.
      releaseDeviceAccountOwner(browserLocalStorage(), browserSessionStorage());
      emitDeviceIdentityChanged();
      // The account that is leaving takes its stored refresh token with it, and
      // "all accounts" takes the whole lane. Neither is a capability: they are
      // the same act at two scopes, and the second only exists because a device
      // can hold more than one account.
      if (scope === "device") forgetAllDeviceAccounts(browserLocalStorage());
      else if (departing) forgetDeviceAccount(browserLocalStorage(), departing);
      emitDeviceAccountSessionsChanged();
      setWelcomeBack(null);
      await supabase.auth.signOut();
      // onAuthStateChange fires SIGNED_OUT → session clears via the subscription.
      if (scope === "device") return;
      // The person asked to leave ONE account on a device that still holds
      // another signed-in one. Leaving it signed out would strand a session
      // nothing on this page can reach, so the next remembered account takes
      // over through the one switch path. Its own arrival line names it, so
      // nobody is quietly renamed. A refusal simply leaves the device signed out.
      const next = nextSignedInDeviceAccount(
        readDeviceAccounts(browserLocalStorage()),
        departing,
      );
      if (!next) return;
      await activateDeviceAccount(next.userId, browserDeviceAccountSwitchDeps());
    },
    [],
  );

  const switchAccount = useCallback(
    async (userId: string): Promise<DeviceAccountSwitchOutcome> => {
      if (userId === sessionTransitions.current.currentUserId()) {
        return { status: "switched", userId };
      }
      const outcome = await activateDeviceAccount(
        userId,
        browserDeviceAccountSwitchDeps(),
      );
      emitDeviceAccountSessionsChanged();
      if (outcome.status === "switched") trackEvent("account_switched");
      return outcome;
    },
    [],
  );

  useEffect(() => {
    publishAuthActionState({
      status: !configured
        ? "signed-out"
        : loading
          ? "unknown"
          : session
            ? "signed-in"
            : supabaseProviderState === "unavailable"
              ? "unknown"
              : "signed-out",
      identityResolved:
        !configured || (canonicalIdentityState.status === "resolved" && !loading),
    });
  }, [canonicalIdentityState.status, configured, loading, session, supabaseProviderState]);

  const resumeSignIn = useCallback(async (next?: string): Promise<MagicLinkResult> => {
    if (typeof window === "undefined") {
      return { status: "error", message: "Sign-in is unavailable on this page." };
    }
    const attempt = await prepareAuthCallback(
      window.location.href,
      next ?? defaultEmailAuthNext(window.location.href),
    );
    if ("navigationStarted" in attempt) {
      return { status: "error", message: "Continue sign-in on pubmaxxing.com." };
    }
    if (!attempt.ok) return { status: "error", message: attempt.message };
    const result = await requestResumeLink(attempt.callbackUrl);
    if (result.status !== "sent") {
      releaseBrowserAuthAttempt(attempt.id);
    }
    return result;
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const contributionAuth = accountComposerAuth(
      user?.id ?? null,
      session,
      rejectedContributionAuth,
    );
    const canonicalIdentity =
      canonicalIdentityState.status === "resolved"
        ? canonicalIdentityState.identity
        : null;
    return {
      session,
      user,
      loading,
      configured,
      clerkIntegrationConfigured,
      socialProviders,
      socialProvidersResolved: !configured || socialProviderRead !== null,
      signInWithGoogle,
      signInWithApple,
      signInWithMicrosoft,
      signInWithEmail,
      cancelAuthAttempt: cancelBrowserAuthAttempt,
      signOut,
      switchAccount,
      welcomeBack: user ? null : welcomeBack,
      resumeSignIn,
      handle: identityHandleForOwner(
        canonicalIdentity,
        user?.id ?? null,
      ),
      identityResolved:
        canonicalIdentityState.status === "resolved" && !loading,
      retryIdentity,
      accountRevision,
      providerAuthState,
      supabaseAuthState: supabaseProviderState,
      rejectedContributionAuth,
      contributionAuth,
      invalidateContributionAuth,
      getCurrentUserId,
    };
  }, [
    session,
    loading,
    configured,
    clerkIntegrationConfigured,
    socialProviders,
    socialProviderRead,
    signInWithGoogle,
    signInWithApple,
    signInWithMicrosoft,
    signInWithEmail,
    signOut,
    switchAccount,
    welcomeBack,
    resumeSignIn,
    canonicalIdentityState,
    retryIdentity,
    accountRevision,
    providerAuthState,
    supabaseProviderState,
    rejectedContributionAuth,
    invalidateContributionAuth,
    getCurrentUserId,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {authBannedNotice ? (
        <AuthAccountBannedNotice onDismiss={() => setAuthBannedNotice(false)} />
      ) : authCallbackConfirmation ? (
        <div className="authCallbackNotice authCallbackNotice--confirm" role="alert">
          <span>
            {authCallbackConfirmation.label
              ? `Sign in as ${authCallbackConfirmation.label}?`
              : "Sign in to this account?"}
          </span>
          <div className="authCallbackNoticeActions">
            <button
              type="button"
              onClick={() => {
                const pending = authCallbackConfirmation;
                setAuthCallbackConfirmation(null);
                pending.confirm();
              }}
            >
              Continue
            </button>
            <button type="button" onClick={() => setAuthCallbackConfirmation(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : authCallbackError ? (
        <div className="authCallbackNotice" role="alert">
          <span>{authCallbackError}</span>
          <button type="button" onClick={() => setAuthCallbackError(null)}>
            Dismiss
          </button>
        </div>
      ) : authSignedInNotice ? (
        <div className="authCallbackNotice authCallbackNotice--ok" role="status">
          <span>{authSignedInNotice}</span>
          <button type="button" onClick={() => setAuthSignedInNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {/* The warm second after a sign-in lands. Not a dialog and not a gate:
          it names the person and retires itself. */}
      <ArrivalWelcome />
      {/* Signed-out account nudge after a high-intent action. Self-gates on
          auth + a pending trigger, so it renders nothing until armed. */}
      <AccountOnboarding />
      <IdentityNudge />
    </AuthContext.Provider>
  );
}
