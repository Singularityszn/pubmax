/**
 * Keep post-auth navigation on the app origin. This is shared by every auth
 * entry point so adding a new provider cannot accidentally add an open redirect.
 */
export function safeAuthNext(raw: string | null | undefined, origin: string): string {
  if (!raw) return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/";
  }

  try {
    const allowedOrigin = new URL(origin).origin;
    const destination = new URL(trimmed, allowedOrigin);
    if (destination.origin !== allowedOrigin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}` || "/";
  } catch {
    return "/";
  }
}

const AUTH_ACTIVE_ATTEMPT_KEY = "pubmax_auth_active_attempt";
const AUTH_TAB_ATTEMPT_KEY = "pubmax_auth_tab_attempt";
const AUTH_RETURN_FRAGMENT_PREFIX = "pubmax_auth_return_fragment:";
const AUTH_ATTEMPT_TTL_MS = 60 * 60 * 1000;
const AUTH_ATTEMPT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const AUTH_CALLBACK_MARKER = "_authCallback";
export const AUTH_ATTEMPT_PARAM = "_authAttempt";
export const AUTH_ATTEMPT_IN_PROGRESS_MESSAGE =
  "A sign-in is already in progress in this browser. Finish that attempt before starting another.";
export const AUTH_STORAGE_UNAVAILABLE_MESSAGE =
  "Sign-in needs browser storage. Enable site storage, then try again.";
export const AUTH_COORDINATION_UNAVAILABLE_MESSAGE =
  "This browser cannot safely coordinate sign-in tabs. Close other PUBMAXX tabs, update your browser, and try again.";

export type AuthFragmentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredActiveAttempt = {
  id: string;
  expiresAt: number;
};

type StoredTabAttempt = StoredActiveAttempt & {
  consumed: boolean;
};

type StoredAuthFragment = StoredActiveAttempt & {
  origin: string;
  path: string;
  hash: string;
};

type AuthCrypto = Pick<Crypto, "getRandomValues">;
type AuthLockManager = Pick<LockManager, "request">;

export type AuthAttemptOptions = {
  /** Browser-wide attempt claim. This must be localStorage in production. */
  persistentStorage?: AuthFragmentStorage | null;
  /** Initiating-tab marker and return capability. This must be sessionStorage. */
  tabStorage?: AuthFragmentStorage | null;
  cryptoProvider?: AuthCrypto | null;
  lockManager?: AuthLockManager | null;
  now?: number;
};

export type AuthAttemptStart =
  | { ok: true; id: string; callbackUrl: string }
  | { ok: false; message: string };

export type AuthCallbackAttempt = {
  attemptId: string | null;
  code: string | null;
  providerError: boolean;
};

export type CapturedAuthCallback = {
  attempt: AuthCallbackAttempt;
  cleanUrl: string;
};

function authFragmentKey(attemptId: string): string {
  return `${AUTH_RETURN_FRAGMENT_PREFIX}${attemptId}`;
}

export function isAuthAttemptId(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && AUTH_ATTEMPT_ID_PATTERN.test(raw);
}

function authDestination(currentUrl: string, requestedNext?: string): URL | null {
  try {
    const current = new URL(currentUrl);
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    const currentPath = `${current.pathname}${current.search}${current.hash}`;
    return new URL(
      safeAuthNext(
        requestedNext ?? (current.pathname === "/auth/callback" ? "/" : currentPath),
        current.origin,
      ),
      current.origin,
    );
  } catch {
    return null;
  }
}

function randomAuthAttemptId(cryptoProvider?: AuthCrypto | null): string | null {
  if (!cryptoProvider) return null;
  try {
    const bytes = new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function readActiveAttempt(storage: AuthFragmentStorage): StoredActiveAttempt | null {
  return parseStoredAttempt(storage.getItem(AUTH_ACTIVE_ATTEMPT_KEY));
}

function readTabAttempt(storage: AuthFragmentStorage): StoredTabAttempt | null {
  const raw = storage.getItem(AUTH_TAB_ATTEMPT_KEY);
  const attempt = parseStoredAttempt(raw);
  if (!attempt) return null;
  try {
    const record = JSON.parse(raw ?? "null") as Partial<StoredTabAttempt> | null;
    return { ...attempt, consumed: record?.consumed === true };
  } catch {
    return null;
  }
}

function parseStoredAttempt(raw: string | null): StoredActiveAttempt | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<StoredActiveAttempt>;
    if (!isAuthAttemptId(record.id) || typeof record.expiresAt !== "number") return null;
    return { id: record.id, expiresAt: record.expiresAt };
  } catch {
    return null;
  }
}

type StorageMutation = {
  storage: AuthFragmentStorage;
  key: string;
  value: string | null;
};

/** Best-effort transaction across the two browser stores while the Web Lock is held. */
function applyStorageMutations(mutations: StorageMutation[]): boolean {
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

/** Build an allowlisted callback. The attempt id is generated by beginAuthAttempt. */
export function buildAuthCallbackUrl(
  currentUrl: string,
  requestedNext?: string,
  attemptId?: string,
): string | null {
  try {
    const current = new URL(currentUrl);
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    const destination = authDestination(currentUrl, requestedNext);
    if (!destination) return null;
    // Never place a fragment in redirectTo. Fragments can contain one-use
    // capabilities and become server-visible when nested inside this query.
    const next = `${destination.pathname}${destination.search}` || "/";
    const callback = new URL("/auth/callback", current.origin);
    if (next !== "/") callback.searchParams.set("next", next);
    if (attemptId) {
      if (!isAuthAttemptId(attemptId)) return null;
      callback.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
    }
    return callback.toString();
  } catch {
    return null;
  }
}

/**
 * Start one browser-wide auth attempt. Supabase stores one PKCE verifier per
 * project, so a second tab must not overwrite it while the first link is live.
 */
export function beginAuthAttempt(
  currentUrl: string,
  requestedNext: string | undefined,
  options: Omit<AuthAttemptOptions, "lockManager">,
): AuthAttemptStart {
  const {
    persistentStorage,
    tabStorage,
    cryptoProvider,
    now = Date.now(),
  } = options;
  if (!persistentStorage || !tabStorage || persistentStorage === tabStorage) {
    return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
  }

  try {
    const active = readActiveAttempt(persistentStorage);
    const tabAttempt = readTabAttempt(tabStorage);
    if (active && active.expiresAt > now) {
      const sameInitiatingTab = Boolean(
        tabAttempt &&
          tabAttempt.id === active.id &&
          tabAttempt.expiresAt === active.expiresAt &&
          tabAttempt.expiresAt > now &&
          !tabAttempt.consumed,
      );
      if (!sameInitiatingTab) {
        return { ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE };
      }
    }

    const id = randomAuthAttemptId(cryptoProvider);
    const destination = authDestination(currentUrl, requestedNext);
    const callbackUrl = id
      ? buildAuthCallbackUrl(currentUrl, requestedNext, id)
      : null;
    if (!id || !destination || !callbackUrl) {
      return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
    }

    const expiresAt = now + AUTH_ATTEMPT_TTL_MS;
    const storedAttempt = JSON.stringify({ id, expiresAt } satisfies StoredActiveAttempt);
    const storedTabAttempt = JSON.stringify({
      id,
      expiresAt,
      consumed: false,
    } satisfies StoredTabAttempt);
    const mutations: StorageMutation[] = [
      {
        storage: persistentStorage,
        key: AUTH_ACTIVE_ATTEMPT_KEY,
        value: storedAttempt,
      },
      {
        storage: tabStorage,
        key: AUTH_TAB_ATTEMPT_KEY,
        value: storedTabAttempt,
      },
    ];
    if (destination.hash) {
      const fragment: StoredAuthFragment = {
        id,
        origin: destination.origin,
        path: `${destination.pathname}${destination.search}`,
        hash: destination.hash,
        expiresAt,
      };
      mutations.push({
        storage: tabStorage,
        key: authFragmentKey(id),
        value: JSON.stringify(fragment),
      });
    }
    if (tabAttempt && tabAttempt.id !== id) {
      mutations.push({
        storage: tabStorage,
        key: authFragmentKey(tabAttempt.id),
        value: null,
      });
    }
    // Clean up fragments written by the previous browser-wide implementation.
    // New capability fragments are written only to the initiating tab above.
    if (active) {
      mutations.push({
        storage: persistentStorage,
        key: authFragmentKey(active.id),
        value: null,
      });
    }
    if (!applyStorageMutations(mutations)) {
      return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
    }
    return { ok: true, id, callbackUrl };
  } catch {
    return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
  }
}

/** Atomically claim the browser-wide verifier across tabs via the Web Locks API. */
export async function beginCoordinatedAuthAttempt(
  currentUrl: string,
  requestedNext: string | undefined,
  options: AuthAttemptOptions,
): Promise<AuthAttemptStart> {
  const { persistentStorage, tabStorage, lockManager } = options;
  if (!persistentStorage || !tabStorage || persistentStorage === tabStorage) {
    return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
  }
  if (!lockManager) {
    return { ok: false, message: AUTH_COORDINATION_UNAVAILABLE_MESSAGE };
  }
  try {
    return await lockManager.request("pubmax-auth-attempt", async () =>
      beginAuthAttempt(currentUrl, requestedNext, options),
    );
  } catch {
    return { ok: false, message: AUTH_COORDINATION_UNAVAILABLE_MESSAGE };
  }
}

/** Release only the matching lock; another tab's attempt is never disturbed. */
export function releaseAuthAttempt(
  attemptId: string,
  persistentStorage?: AuthFragmentStorage | null,
  tabStorage?: AuthFragmentStorage | null,
): void {
  if (!isAuthAttemptId(attemptId)) return;
  try {
    if (persistentStorage) {
      const active = readActiveAttempt(persistentStorage);
      if (active?.id === attemptId) persistentStorage.removeItem(AUTH_ACTIVE_ATTEMPT_KEY);
      // Legacy cleanup only; capability fragments are no longer persisted here.
      persistentStorage.removeItem(authFragmentKey(attemptId));
    }
  } catch {
    // Best-effort cleanup; TTL keeps an abandoned lock bounded.
  }
  try {
    if (tabStorage) {
      const tabAttempt = readTabAttempt(tabStorage);
      if (tabAttempt?.id === attemptId) tabStorage.removeItem(AUTH_TAB_ATTEMPT_KEY);
      tabStorage.removeItem(authFragmentKey(attemptId));
    }
  } catch {
    // Best-effort cleanup; a later same-tab restart or the TTL can recover.
  }
}

function consumeAuthCallbackTabState(
  currentUrl: string,
  attemptId: string,
  tabAttempt: StoredTabAttempt,
  tabStorage: AuthFragmentStorage,
  now = Date.now(),
): { ok: boolean; fragment: string } {
  if (!isAuthAttemptId(attemptId)) return { ok: false, fragment: "" };
  try {
    const key = authFragmentKey(attemptId);
    const raw = tabStorage.getItem(key);
    let fragment = "";
    if (raw) {
      const record = JSON.parse(raw) as Partial<StoredAuthFragment>;
      const current = new URL(currentUrl);
      current.searchParams.delete("code");
      current.searchParams.delete(AUTH_CALLBACK_MARKER);
      current.searchParams.delete(AUTH_ATTEMPT_PARAM);
      current.searchParams.delete("authError");
      const path = `${current.pathname}${current.search}`;
      if (
        record.id === attemptId &&
        record.origin === current.origin &&
        record.path === path &&
        typeof record.hash === "string" &&
        record.hash.startsWith("#") &&
        typeof record.expiresAt === "number" &&
        record.expiresAt >= now
      ) {
        fragment = record.hash;
      }
    }
    const consumedAttempt = JSON.stringify({
      id: tabAttempt.id,
      expiresAt: tabAttempt.expiresAt,
      consumed: true,
    } satisfies StoredTabAttempt);
    const ok = applyStorageMutations([
      { storage: tabStorage, key: AUTH_TAB_ATTEMPT_KEY, value: consumedAttempt },
      { storage: tabStorage, key, value: null },
    ]);
    return { ok, fragment: ok ? fragment : "" };
  } catch {
    return { ok: false, fragment: "" };
  }
}

/** Read callback parameters minted by our server callback route. */
export function readAuthCallbackAttempt(currentUrl: string): AuthCallbackAttempt | null {
  try {
    const current = new URL(currentUrl);
    const providerError = current.searchParams.get("authError") === "1";
    if (current.searchParams.get(AUTH_CALLBACK_MARKER) !== "1" && !providerError) return null;
    const rawAttemptId = current.searchParams.get(AUTH_ATTEMPT_PARAM);
    const attemptId = isAuthAttemptId(rawAttemptId) ? rawAttemptId : null;
    return {
      attemptId,
      code: attemptId && !providerError ? current.searchParams.get("code") : null,
      providerError: providerError || !attemptId,
    };
  } catch {
    return null;
  }
}

/** Capture all callback state locally and return a URL safe to show immediately. */
export function captureAuthCallback(
  currentUrl: string,
  persistentStorage?: AuthFragmentStorage | null,
  tabStorage?: AuthFragmentStorage | null,
  now = Date.now(),
): CapturedAuthCallback | null {
  const parsedAttempt = readAuthCallbackAttempt(currentUrl);
  if (!parsedAttempt) return null;
  const current = new URL(currentUrl);
  let active: StoredActiveAttempt | null = null;
  let tabAttempt: StoredTabAttempt | null = null;
  try {
    active = persistentStorage ? readActiveAttempt(persistentStorage) : null;
    tabAttempt = tabStorage ? readTabAttempt(tabStorage) : null;
  } catch {
    // Storage failures reject the callback without exposing its one-use code.
  }
  const matchesActiveAttempt = Boolean(
    parsedAttempt.attemptId &&
      active?.id === parsedAttempt.attemptId &&
      active.expiresAt > now &&
      tabAttempt?.id === parsedAttempt.attemptId &&
      tabAttempt.expiresAt === active.expiresAt &&
      tabAttempt.expiresAt > now &&
      !tabAttempt.consumed,
  );
  const consumed =
    matchesActiveAttempt && parsedAttempt.attemptId && tabAttempt && tabStorage
      ? consumeAuthCallbackTabState(
          currentUrl,
          parsedAttempt.attemptId,
          tabAttempt,
          tabStorage,
          now,
        )
      : { ok: false, fragment: "" };
  // Never expose a code to AuthProvider unless it belongs to the exact live
  // browser attempt. A mismatched/injected/replayed callback must not consume
  // the real attempt's verifier, fragment, or lock.
  const attempt: AuthCallbackAttempt = matchesActiveAttempt && consumed.ok
    ? parsedAttempt
    : { attemptId: null, code: null, providerError: true };
  const fragment = consumed.fragment;
  current.searchParams.delete("code");
  current.searchParams.delete(AUTH_CALLBACK_MARKER);
  current.searchParams.delete(AUTH_ATTEMPT_PARAM);
  current.searchParams.delete("authError");
  if (fragment) current.hash = fragment;
  return {
    attempt,
    cleanUrl: `${current.pathname}${current.search}${current.hash}` || "/",
  };
}

/** Scrub callback credentials synchronously before the caller starts exchange. */
export function scrubAuthCallback(
  currentUrl: string,
  replaceUrl: (cleanUrl: string) => void,
  persistentStorage?: AuthFragmentStorage | null,
  tabStorage?: AuthFragmentStorage | null,
  now = Date.now(),
): CapturedAuthCallback | null {
  const captured = captureAuthCallback(currentUrl, persistentStorage, tabStorage, now);
  if (captured) replaceUrl(captured.cleanUrl);
  return captured;
}
