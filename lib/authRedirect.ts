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

/** Build the allowlisted web callback URL used by OAuth and email magic links. */
export function buildAuthCallbackUrl(currentUrl: string, requestedNext?: string): string | null {
  try {
    const current = new URL(currentUrl);
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    const currentPath = `${current.pathname}${current.search}${current.hash}`;
    const next = safeAuthNext(
      requestedNext ?? (current.pathname === "/auth/callback" ? "/" : currentPath),
      current.origin,
    );
    const callback = new URL("/auth/callback", current.origin);
    if (next !== "/") callback.searchParams.set("next", next);
    return callback.toString();
  } catch {
    return null;
  }
}
