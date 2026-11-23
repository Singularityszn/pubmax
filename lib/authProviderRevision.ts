type AuthProviderName = "clerk" | "supabase";
export type ProviderAuthState =
  | "unresolved"
  | "authenticated"
  | "signed-out"
  | "unavailable";

/**
 * Whether a provider has TOLD US about the viewer.
 *
 * TWO of the four states mean "not told", and they must be read together or a
 * surface half-learns the rule. `unresolved` is "still asking"; `unavailable`
 * is "the client could not load, so we know nothing", which AuthProvider sets
 * deliberately to stop the ceiling speaking for the viewer.
 *
 * The landing header enumerated `unresolved` alone and let `unavailable`
 * through, so a drinker with a long-lived session met "Sign in" while every
 * surface on the viewer-session seam knew the account perfectly well. The two
 * states are named here, once, because enumerating them per surface is exactly
 * how that happened.
 */
export function providerHasAnswered(state: ProviderAuthState): boolean {
  return state === "authenticated" || state === "signed-out";
}

export type SupabaseAuthSettlement =
  | "initial-session"
  | "auth-event"
  | "bootstrap"
  | "timeout";

/**
 * Decide when Supabase may publish an authentication answer.
 *
 * A null INITIAL_SESSION event is only an event-stream marker. Durable resume
 * may still restore an account, so it must preserve the provider's state.
 * A timeout is not an authentication answer. It may leave a bound account
 * unchanged or publish unavailable, but it may never claim signed out.
 */
export function resolveSupabaseAuthState(
  settlement: SupabaseAuthSettlement,
  hasSession: boolean,
  currentUserId: string | null,
): ProviderAuthState | null {
  if (hasSession) return "authenticated";
  if (settlement === "initial-session") return null;
  if (settlement === "timeout") {
    return currentUserId !== null ? null : "unavailable";
  }
  return "signed-out";
}

export type ProviderIdentityRevisionStore = {
  read: () => number;
  signal: () => AbortSignal;
  accountRevision: () => number;
  accountSignal: () => AbortSignal;
  answeredAccountSignal: () => AbortSignal;
  ownsSession: (provider: AuthProviderName, sessionUserId: string | null | undefined) => boolean;
  set: (provider: AuthProviderName, identity: string | null) => number;
  setAuthState: (provider: AuthProviderName, state: ProviderAuthState) => number;
  authState: (provider: AuthProviderName) => ProviderAuthState;
  subscribe: (listener: () => void) => () => void;
};

/**
 * One opaque account boundary for every browser identity provider.
 *
 * Provider IDs never leave this module. Consumers need to know that an
 * account changed, not which provider owns it, and the revision also works
 * when a Clerk-backed Social account has no Supabase User ID.
 */
export function createProviderIdentityRevisionStore(): ProviderIdentityRevisionStore {
  let revision = 0;
  let accountRevision = 0;
  let revisionController = new AbortController();
  let accountController = new AbortController();
  const identities: Record<AuthProviderName, string | null> = {
    clerk: null,
    supabase: null,
  };
  const authStates: Record<AuthProviderName, ProviderAuthState> = {
    clerk: "unresolved",
    supabase: "unresolved",
  };
  const answers: Record<AuthProviderName, string | null | undefined> = {
    clerk: undefined,
    supabase: undefined,
  };
  let answeredAccountController = new AbortController();
  const listeners = new Set<() => void>();
  // A provider answers with an identity, or with signed-out and no identity.
  // Its first answer settles who started the work, so it is not a change.
  const recordAnswer = (provider: AuthProviderName): void => {
    const answer = identities[provider]
      ?? (authStates[provider] === "signed-out" ? null : undefined);
    if (answer === undefined || answer === answers[provider]) return;
    const settling = answers[provider] === undefined;
    answers[provider] = answer;
    if (settling) return;
    const previousController = answeredAccountController;
    answeredAccountController = new AbortController();
    previousController.abort(new DOMException("The operation was aborted.", "AbortError"));
  };
  const advanceRevision = (): number => {
    revision += 1;
    const previousController = revisionController;
    revisionController = new AbortController();
    previousController.abort(new DOMException("The operation was aborted.", "AbortError"));
    for (const listener of listeners) listener();
    return revision;
  };
  const advanceAccountRevision = (): number => {
    accountRevision += 1;
    const previousController = accountController;
    accountController = new AbortController();
    previousController.abort(new DOMException("The operation was aborted.", "AbortError"));
    return accountRevision;
  };

  return {
    read: () => revision,
    signal: () => revisionController.signal,
    accountRevision: () => accountRevision,
    accountSignal: () => accountController.signal,
    answeredAccountSignal: () => answeredAccountController.signal,
    ownsSession: (provider, sessionUserId) =>
      typeof sessionUserId === "string" && sessionUserId.length > 0 && identities[provider] === sessionUserId,
    set(provider, identity) {
      if (identities[provider] === identity) return revision;
      identities[provider] = identity;
      advanceAccountRevision();
      recordAnswer(provider);
      return advanceRevision();
    },
    setAuthState(provider, state) {
      if (authStates[provider] === state) return revision;
      authStates[provider] = state;
      recordAnswer(provider);
      return advanceRevision();
    },
    authState: (provider) => authStates[provider],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const providerIdentityRevisionStore = createProviderIdentityRevisionStore();

export const readProviderIdentityRevision = providerIdentityRevisionStore.read;
export const readProviderAccountRevision = providerIdentityRevisionStore.accountRevision;
export const readProviderAccountSignal = providerIdentityRevisionStore.accountSignal;
/**
 * Aborts when an answered account changes: A to B, A to signed out, or signed
 * out to A. A provider's first answer keeps it, so work started while the
 * session was unresolved survives the session settling.
 */
export const readProviderAnsweredAccountSignal = providerIdentityRevisionStore.answeredAccountSignal;
/** Check a credential's owner without releasing provider IDs to consumers. */
export const providerOwnsSession = providerIdentityRevisionStore.ownsSession;
export const setProviderIdentity = providerIdentityRevisionStore.set;
export const setProviderAuthState = providerIdentityRevisionStore.setAuthState;
export const readProviderAuthState = providerIdentityRevisionStore.authState;
export const subscribeProviderIdentityRevision = providerIdentityRevisionStore.subscribe;
