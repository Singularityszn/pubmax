export type AuthFragmentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StorageMutation = {
  storage: AuthFragmentStorage;
  key: string;
  value: string | null;
};

/** Best-effort transaction across the two browser stores while the Web Lock is held. */
export function applyStorageMutations(mutations: StorageMutation[]): boolean {
  const snapshots: Array<StorageMutation> = [];
  try {
    for (const mutation of mutations) {
      snapshots.push({
        storage: mutation.storage,
        key: mutation.key,
        value: mutation.storage.getItem(mutation.key),
      });
    }
    for (const mutation of mutations) {
      if (mutation.value === null) mutation.storage.removeItem(mutation.key);
      else mutation.storage.setItem(mutation.key, mutation.value);
    }
    return true;
  } catch {
    for (const snapshot of snapshots.reverse()) {
      try {
        if (snapshot.value === null) snapshot.storage.removeItem(snapshot.key);
        else snapshot.storage.setItem(snapshot.key, snapshot.value);
      } catch {
        // A blocked store may also reject rollback. Never proceed to the provider.
      }
    }
    return false;
  }
}
