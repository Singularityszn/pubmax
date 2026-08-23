export type AuthProviderName = "clerk" | "supabase";

export type ProviderIdentityRevisionStore = {
  read: () => number;
  set: (provider: AuthProviderName, identity: string | null) => number;
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
  const identities: Record<AuthProviderName, string | null> = {
    clerk: null,
    supabase: null,
  };
  const listeners = new Set<() => void>();

  return {
    read: () => revision,
    set(provider, identity) {
      if (identities[provider] === identity) return revision;
      identities[provider] = identity;
      revision += 1;
      for (const listener of listeners) listener();
      return revision;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const providerIdentityRevisionStore = createProviderIdentityRevisionStore();

export const readProviderIdentityRevision = providerIdentityRevisionStore.read;
export const setProviderIdentity = providerIdentityRevisionStore.set;
export const subscribeProviderIdentityRevision = providerIdentityRevisionStore.subscribe;
