import type { MagicLinkResult } from "@/lib/passwordlessAuth";
import type { AuthContextValue, CancelAuthAttemptOptions } from "@/components/auth/authContext";
import { NO_SOCIAL_AUTH_PROVIDERS, type SocialAuthProviderAvailability } from "@/lib/authProviderAvailability";

const LOAD_ERROR = "Sign-in could not load. Check your connection and try again.";
const CANCELLED = { status: "cancelled", message: "" } as const;

/** Transports the runtime's committed context. It never establishes a session. */
export function createAuthContextBridge(
  config: Pick<AuthContextValue, "configured" | "clerkIntegrationConfigured">,
  deps: { cancelPending: (options?: CancelAuthAttemptOptions) => void; accountSignal: () => AbortSignal },
) {
  let runtime: AuthContextValue | null = null;
  let closed = false;
  let failed = false;
  let generation = 0;
  let mountVersion = 0;
  const listeners = new Set<() => void>();
  const waiters = new Set<(value: AuthContextValue | null) => void>();
  const mounted = () => runtime ? Promise.resolve(runtime) : closed || failed
    ? Promise.resolve(null)
    : new Promise<AuthContextValue | null>((resolve) => waiters.add(resolve));
  const notify = () => { for (const listener of listeners) listener(); };
  const settle = (value: AuthContextValue | null) => {
    for (const resolve of waiters) resolve(value);
    waiters.clear();
  };
  async function start<T>(run: (value: AuthContextValue) => Promise<T>, cancelled: T, unavailable: T): Promise<T> {
    const ticket = ++generation;
    const owner = deps.accountSignal();
    const value = runtime ?? await mounted();
    if (closed || ticket !== generation || owner.aborted) return cancelled;
    if (!value) return unavailable;
    return run(value);
  }
  const actions: Pick<AuthContextValue,
    "signInWithGoogle" | "signInWithApple" | "signInWithMicrosoft" | "signInWithEmail" |
    "resumeSignIn" | "cancelAuthAttempt" | "signOut" | "switchAccount" | "retryIdentity" |
    "invalidateContributionAuth" | "getCurrentUserId" | "waitForAuthRuntime"
  > = {
    signInWithGoogle: (next) => start((value) => value.signInWithGoogle(next), { error: "Sign-in was cancelled." }, { error: LOAD_ERROR }),
    signInWithApple: (next) => start((value) => value.signInWithApple(next), { error: "Sign-in was cancelled." }, { error: LOAD_ERROR }),
    signInWithMicrosoft: (next) => start((value) => value.signInWithMicrosoft(next), { error: "Sign-in was cancelled." }, { error: LOAD_ERROR }),
    signInWithEmail: (email, next) => start<MagicLinkResult>((value) => value.signInWithEmail(email, next), CANCELLED, { status: "error", message: LOAD_ERROR }),
    resumeSignIn: (next) => start<MagicLinkResult>((value) => value.resumeSignIn(next), CANCELLED, { status: "error", message: LOAD_ERROR }),
    cancelAuthAttempt: (options) => {
      generation += 1;
      if (runtime) runtime.cancelAuthAttempt(options);
      else deps.cancelPending(options);
    },
    signOut: async (scope) => {
      generation += 1;
      const owner = deps.accountSignal();
      const value = runtime ?? await mounted();
      if (value && !closed && !owner.aborted) await value.signOut(scope);
    },
    switchAccount: async (userId) => {
      generation += 1;
      const owner = deps.accountSignal();
      const value = runtime ?? await mounted();
      return value && !closed && !owner.aborted ? value.switchAccount(userId) : { status: "unavailable" };
    },
    retryIdentity: () => { runtime?.retryIdentity(); },
    invalidateContributionAuth: (auth) => { runtime?.invalidateContributionAuth(auth); },
    getCurrentUserId: () => runtime?.getCurrentUserId() ?? null,
    waitForAuthRuntime: async () => {
      const owner = deps.accountSignal();
      const value = runtime ?? await mounted();
      if (!value || closed || failed || owner.aborted) return false;
      const ready = await (value.waitForAuthRuntime?.() ?? true);
      return ready && !closed && !owner.aborted;
    },
  };
  let snapshot: AuthContextValue = {
    ...config, ...actions,
    session: null, user: null, loading: config.configured,
    socialProviders: NO_SOCIAL_AUTH_PROVIDERS, socialProvidersResolved: !config.configured,
    welcomeBack: null, handle: null, identityResolved: false, identityUnavailable: false,
    accountRevision: 0,
    providerAuthState: config.configured || config.clerkIntegrationConfigured ? "unresolved" : "signed-out",
    supabaseAuthState: config.configured ? "unresolved" : "signed-out",
    rejectedContributionAuth: null, contributionAuth: null,
  };
  return {
    mount: () => ++mountVersion,
    ownsMount: (version: number) => mountVersion === version,
    read: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish: (value: AuthContextValue) => {
      if (closed || failed) return;
      runtime = value;
      snapshot = { ...value, ...actions };
      settle(value);
      notify();
    },
    socialProviders: (availability: SocialAuthProviderAvailability) => {
      if (runtime || closed || failed) return;
      snapshot = { ...snapshot, socialProviders: availability, socialProvidersResolved: true };
      notify();
    },
    fail: () => {
      if (closed) return;
      failed = true;
      runtime = null;
      snapshot = { ...snapshot, loading: false, providerAuthState: "unavailable", supabaseAuthState: "unavailable" };
      settle(null);
      notify();
    },
    dispose: () => { closed = true; generation += 1; runtime = null; settle(null); },
  };
}
