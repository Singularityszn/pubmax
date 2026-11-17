// public/theme-init.js writes the same flag before React mounts.
export const SESSION_ENTRY_CONSUMED_KEY = "pubmax:entryDecision:consumed:v1";
const SESSION_ENTRY_KEY = SESSION_ENTRY_CONSUMED_KEY;

function resolveSessionStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function hasConsumedSessionEntry(storage?: Storage | null): boolean {
  const store = resolveSessionStorage(storage);
  if (!store) return false;
  try {
    return store.getItem(SESSION_ENTRY_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSessionEntryConsumed(storage?: Storage | null): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  try {
    store.setItem(SESSION_ENTRY_KEY, "1");
  } catch {
  }
}

export function consumeDeepLinkBootEntry(path: string, storage?: Storage | null): boolean {
  if (path === "/") return false;
  markSessionEntryConsumed(storage);
  return true;
}

