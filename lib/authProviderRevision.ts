export type AuthProviderName = "clerk" | "supabase";
export type ProviderAuthState =
  | "unresolved"
  | "authenticated"
  | "signed-out"
  | "unavailable";

export type SupabaseAuthSettlement =
  | "initial-session"
  | "auth-event"
  | "bootstrap"
  | "timeout";

/**
 * Decide when Supabase may publish an authentication answer.
 *
 * A null INITIAL_SESSION event is only an event-stream marker. Durable resume
 * may still restore an account, so it must leave the provider unresolved.
 * A timeout may settle only when no session event has bound an account.
 */
export function resolveSupabaseAuthState(
  settlement: SupabaseAuthSettlement,
  hasSession: boolean,
  currentUserId: string | null,
): ProviderAuthState | null {
  if (hasSession) return "authenticated";
  if (settlement === "initial-session") return "unresolved";
  if (settlement === "timeout" && currentUserId !== null) return null;
  return "signed-out";
}

export type ProviderIdentityRevisionStore = {
  read: () => number;
  signal: () => AbortSignal;
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
  let revisionController = new AbortController();
  const identities: Record<AuthProviderName, string | null> = {
    clerk: null,
    supabase: null,
  };
  const authStates: Record<AuthProviderName, ProviderAuthState> = {
    clerk: "unresolved",
    supabase: "unresolved",
  };
  const listeners = new Set<() => void>();
  const advanceRevision = (): number => {
    revision += 1;
    const previousController = revisionController;
    revisionController = new AbortController();
    previousController.abort(new DOMException("The operation was aborted.", "AbortError"));
    for (const listener of listeners) listener();
    return revision;
  };

  return {
    read: () => revision,
    signal: () => revisionController.signal,
    set(provider, identity) {
      if (identities[provider] === identity) return revision;
      identities[provider] = identity;
      return advanceRevision();
    },
    setAuthState(provider, state) {
      if (authStates[provider] === state) return revision;
      authStates[provider] = state;
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
export const readProviderIdentitySignal = providerIdentityRevisionStore.signal;
export const setProviderIdentity = providerIdentityRevisionStore.set;
export const setProviderAuthState = providerIdentityRevisionStore.setAuthState;
export const readProviderAuthState = providerIdentityRevisionStore.authState;
export const subscribeProviderIdentityRevision = providerIdentityRevisionStore.subscribe;
