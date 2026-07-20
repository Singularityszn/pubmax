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

const AUTH_RETURN_FRAGMENT_KEY = "pubmax_auth_return_fragment";
const AUTH_RETURN_FRAGMENT_TTL_MS = 60 * 60 * 1000;

export const AUTH_CALLBACK_MARKER = "_authCallback";

type AuthFragmentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredAuthFragment = {
  origin: string;
  path: string;
  hash: string;
  expiresAt: number;
};

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

/**
 * Keep a return fragment in same-origin browser storage instead of serialising
 * it into Supabase's redirect URL. Plan invites deliberately put their one-use
 * capability in the fragment so it never reaches an HTTP server or mail log.
 */
export function rememberAuthReturnFragment(
  currentUrl: string,
  requestedNext?: string,
  storage?: AuthFragmentStorage | null,
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    const destination = authDestination(currentUrl, requestedNext);
    if (!destination?.hash) {
      storage.removeItem(AUTH_RETURN_FRAGMENT_KEY);
      return;
    }
    const record: StoredAuthFragment = {
      origin: destination.origin,
      path: `${destination.pathname}${destination.search}`,
      hash: destination.hash,
      expiresAt: now + AUTH_RETURN_FRAGMENT_TTL_MS,
    };
    storage.setItem(AUTH_RETURN_FRAGMENT_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable in privacy modes. Losing the fragment is safer
    // than copying a capability into the external auth redirect.
  }
}

/** Consume a fresh fragment only when the completed callback returns to its path. */
export function takeAuthReturnFragment(
  currentUrl: string,
  storage?: AuthFragmentStorage | null,
  now = Date.now(),
): string {
  if (!storage) return "";
  try {
    const raw = storage.getItem(AUTH_RETURN_FRAGMENT_KEY);
    storage.removeItem(AUTH_RETURN_FRAGMENT_KEY);
    if (!raw) return "";
    const record = JSON.parse(raw) as Partial<StoredAuthFragment>;
    const current = new URL(currentUrl);
    current.searchParams.delete("code");
    current.searchParams.delete(AUTH_CALLBACK_MARKER);
    current.searchParams.delete("authError");
    const path = `${current.pathname}${current.search}`;
    if (
      record.origin !== current.origin ||
      record.path !== path ||
      typeof record.hash !== "string" ||
      !record.hash.startsWith("#") ||
      typeof record.expiresAt !== "number" ||
      record.expiresAt < now
    ) {
      return "";
    }
    return record.hash;
  } catch {
    return "";
  }
}

export type AuthCallbackAttempt = {
  code: string | null;
  providerError: boolean;
};

/** Read only callback parameters minted by our server callback route. */
export function readAuthCallbackAttempt(currentUrl: string): AuthCallbackAttempt | null {
  try {
    const current = new URL(currentUrl);
    const providerError = current.searchParams.get("authError") === "1";
    if (current.searchParams.get(AUTH_CALLBACK_MARKER) !== "1" && !providerError) return null;
    return { code: current.searchParams.get("code"), providerError };
  } catch {
    return null;
  }
}

/** Remove one-time auth parameters and restore a locally held fragment. */
export function cleanAuthCallbackUrl(
  currentUrl: string,
  storage?: AuthFragmentStorage | null,
  now = Date.now(),
): string {
  const current = new URL(currentUrl);
  const fragment = takeAuthReturnFragment(currentUrl, storage, now);
  current.searchParams.delete("code");
  current.searchParams.delete(AUTH_CALLBACK_MARKER);
  current.searchParams.delete("authError");
  if (fragment) current.hash = fragment;
  return `${current.pathname}${current.search}${current.hash}` || "/";
}

/** Build the allowlisted web callback URL used by OAuth and email magic links. */
export function buildAuthCallbackUrl(currentUrl: string, requestedNext?: string): string | null {
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
    return callback.toString();
  } catch {
    return null;
  }
}
